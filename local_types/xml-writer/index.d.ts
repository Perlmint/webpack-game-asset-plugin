declare class XMLWriter {
    constructor(indent?: boolean | string, writer?: (text: string, encoding: string) => void);

    text(content: string): this;
    writeRaw(content: string): this;

    startDocument(version?: string, encoding?: string, standalone?: boolean): void;
    endDocument(): this;

    writeElement(name: string, content: string): this;
    writeElementNS(prefix: string, name: string, uri: string, content?: string): this;
    startElement(name: string): this;
    startElementNS(prefix: string, name: string, uri: string): this;
    endElement(): this;

    startAttributes(): this;
    endAttributes(): this;
    writeAttribute(name: string, value: XMLWriter.AttributeContent): this;
    writeAttributeNS(prefix: string, name: string, uri: string, value: XMLWriter.AttributeContent): this;
    startAttribute(name: string): this;
    startAttributeNS(prefix: string, name: string, uri: string): this;
    endAttribute(): this;

    writePI(name: string, content: string): this;
    startPI(name: string): this;
    endPI(): this;

    writeDocType(name: string, pubid: string, sysid: string, subset: string): this;
    startDocType(name: string, pubid: string, sysid: string, subset: string): this;
    endDocType(): this;

    writeCData(content: string): this;
    startCData(): this;
    endCData(): this;

    writeComment(content: string): this;
    startComment(): this;
    endComment(): this;

    toString(): string;
}

declare namespace XMLWriter {
    type AttributeContent = number | string | boolean | (() => number | string | boolean);
}

export = XMLWriter;