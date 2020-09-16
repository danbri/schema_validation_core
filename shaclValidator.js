const SHACLValidator = require('rdf-validate-shacl');
const namedNode = require('n3').DataFactory.namedNode;

const utils = require('./util.js');

/**
 * Adds shacl base prefix to value
 * @param {string} value
 * @return {string}
 */
function SHACL(value) {
    return 'http://www.w3.org/ns/shacl#' + value;
}

class ShaclValidator {
    /**
     * @param {string} shaclSchema - shacl shapes in string format
     * @param {{
     *     context: object|undefined,
     *     annotations: object|undefined,
     *     subclasses: string
     * }} options
     */
    constructor(shaclSchema, options) {
        if (options.subclasses) {
            this.subclasses = utils.parseTurtle(options.subclasses);
        }
        this.shapes = utils.parseTurtle(shaclSchema);
        this.context = options.context || {};
        this.annotations = options.annotations || {};
        this.validator = new SHACLValidator(this.shapes.getQuads());
    }

    /**
     * Transforms SHACL severity to string
     * @param {string} val
     * @returns {string}
     */
    getSeverity(val) {
        switch (val) {
            case SHACL('Info'):
                return 'info';
            case SHACL('Warning'):
                return 'warning';
            default:
                return 'error';
        }
    }

    /**
     * Gets schema: annotations for some predicate
     * @param {namedNode} property - property, which should have an annotation
     * @param {namedNode} annotation - annotation predicate
     * @returns {string|undefined}
     */
    getAnnotation(property, annotation) {
        this.shapes.getQuads(property, annotation, undefined).forEach(quad => {
            return quad.object.value;
        });
    }

    /**
     * Transform standard shacl failure to structured data failure
     * @param {object} shaclFailure
     * @returns {StructuredDataFailure}
     */
    toStructuredDataFailure(shaclFailure) {
        let sourceShape = this.shapes.getQuads(undefined, SHACL('property'), shaclFailure.sourceShape)[0];
        let failure = {
            property: shaclFailure.path ? shaclFailure.path.value : undefined,
            message: shaclFailure.message.length > 0 ?
                shaclFailure.message.map(x => x.value).join(". ") : undefined,
            service: sourceShape.subject.value.replace(/.*[\\/#]/, ''),
            severity: this.getSeverity(shaclFailure.severity.value),
        }
        for (const [key, value] of Object.entries(this.annotations)) {
            failure[key] = this.getAnnotation(shaclFailure.sourceShape, namedNode(value));
        }
        return failure;
    }

    /**
     * @param {string} data
     * @returns {Promise<{baseUrl: string, quads: Store, failures: [StructuredDataFailure]}>}
     */
    async validate(data) {
        let baseUrl = utils.randomUrl();
        let quads = await utils.inputToQuads(data, baseUrl, this.context);
        let report;
        if (this.subclasses) {
            let quadsWithSubclasses = quads.getQuads();
            quadsWithSubclasses.push(...this.subclasses.getQuads());
            report = this.validator.validate(quadsWithSubclasses).results
                .map(x => this.toStructuredDataFailure(x));
        } else {
            report = this.validator.validate(quads.getQuads()).results
                .map(x => this.toStructuredDataFailure(x));
        }
        return {
            baseUrl: baseUrl,
            quads: quads,
            failures: report,
        };
    }
}

/**
 * @typedef {{
 *     property: string,
 *     message: string,
 *     url: string|undefined,
 *     description: string|undefined,
 *     severity: 'error'|'warning'|'info',
 *     service: string,
 *     shape: string
 * }} StructuredDataFailure
 */

module.exports = {
    Validator: ShaclValidator,
}