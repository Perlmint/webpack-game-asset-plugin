import * as bb from "bluebird";
import * as _ from "lodash";
import * as wp from "webpack";
import { Readable } from "stream";
import { extname, dirname, join, basename } from "path";
import { FilesByType, Assets, File, isBitmap, Fonts, BitmapFontConf, ProcessContext, Compilation } from "./option";
import { debug, readFileAsync, parseXMLString } from "./util";
import { createInterface } from "readline";

/**
 * @hidden
 */
async function renderBitmapFont(key: string, name: string, assets: Assets, context: ProcessContext, compilation: Compilation, conf: BitmapFontConf) {
    debug(`[bitmap font - render] ${key}`);
    const { BitmapFont, Canvas, ImageFormat } = await import("bitmapfont");
    const Packer = await import("maxrects-packer");
    const Writer = await import("xml-writer");
    const cacheKey = `font_${key}`;
    const fontInfoName = `${key}.fnt`;
    _.set(assets, ["bitmapFont", key], {
        outFile: fontInfoName
    });
    if (_.isEqual(context.cache[cacheKey], conf)) {
        return;
    }

    debug(`render bitmap font - ${key}
${JSON.stringify(conf)}`);
    context.cache[cacheKey] = conf;
    // bitmapfont config
    const font = new BitmapFont();
    font.family = conf.font;
    font.fill = conf.fill;
    font.size = conf.size;
    font.weight = conf.weight;
    if (conf.stroke) {
        font.strokeThickness = conf.stroke.thickness;
        font.strokeColor = conf.stroke.color;
    }
    if (conf.shadow) {
        font.shadowEnabled = true;
        font.shadowColor = conf.shadow.color;
        font.shadowAngle = conf.shadow.angle;
        font.shadowDistance = conf.shadow.distance;
    }
    const chars = conf.characters.split("").map(ch => ({
        ch, ...font.glyph(ch)
    }));
    const pack = new Packer(2048, 2048, conf.gap);
    let lineHeight = 0;
    const requests = chars.map((info, i) => {
        const chHeight = Math.ceil(info.y2 - info.y1);
        lineHeight = Math.max(lineHeight, chHeight);
        return {
            data: i,
            width: Math.ceil(info.x2 - info.x1) + conf.gap * 2,
            height: chHeight + conf.gap * 2
        };
    });
    const bins = pack.addArray(requests);
    const writer = new Writer();
    writer.startDocument();
    writer.startElement("font");
    writer.startElement("info")
        .writeAttribute("face", key)
        .writeAttribute("size", font.size)
        .writeAttribute("bold", 0)
        .writeAttribute("italic", 0)
        .writeAttribute("charset", "")
        .writeAttribute("unicode", "")
        .writeAttribute("stretchH", 100)
        .writeAttribute("smooth", 1)
        .writeAttribute("aa", 1)
        .writeAttribute("padding", `${conf.gap},${conf.gap},${conf.gap},${conf.gap}`)
        .writeAttribute("spacing", "0,0")
        .writeAttribute("outline", 0);
    writer.startElement("common")
        .writeAttribute("lineHeight", lineHeight)
        .writeAttribute("base", 0)
        .writeAttribute("scaleW", 2048)
        .writeAttribute("scaleH", 2048)
        .writeAttribute("page", 1)
        .writeAttribute("packed", 0);
    writer.startElement("pages");
    for (const bin of pack.bins) {
        const idx = pack.bins.indexOf(bin);
        writer.startElement("page")
            .writeAttribute("id", idx)
            .writeAttribute("file", basename(`${name}_${idx}.png`));
        writer.endElement();
    }
    writer.endElement();
    for (const bin of pack.bins) {
        const canvas = new Canvas(bin.width, bin.height);
        writer.startElement("chars")
            .writeAttribute("count", bin.rects.length);
        const page = pack.bins.indexOf(bin);
        const idx = pack.bins.indexOf(bin);
        for (const rect of bin.rects) {
            const ch = chars[rect.data as number];
            font.draw(canvas, ch.ch, Math.ceil(rect.x - ch.x1), Math.ceil(rect.y + ch.y2));
            writer.startElement("char")
                .writeAttribute("id", ch.ch.charCodeAt(0))
                .writeAttribute("x", rect.x)
                .writeAttribute("y", rect.y)
                .writeAttribute("width", rect.width)
                .writeAttribute("height", rect.height)
                .writeAttribute("xoffset", -ch.x1 | 0)
                .writeAttribute("yoffset", (ch.ascender - ch.y2 + ch.y1) | 0)
                .writeAttribute("xadvance", rect.width)
                .writeAttribute("page", page)
                .writeAttribute("chnl", 15)
                .endElement();
        }
        const imageBlob = canvas.blob(ImageFormat.PNG);
        compilation.emitAsset(`${key}_${idx}.png`, new wp.sources.RawSource(imageBlob, false));
    }
    writer.endDocument();
    const fntInfoBuffer = new Buffer(writer.toString(), "utf-8");
    compilation.emitAsset(fontInfoName, new wp.sources.RawSource(fntInfoBuffer, true));
}

/**
 * @hidden
 */
async function modifyBitmapFontXML(key: string, name: string, assets: Assets, compilation: Compilation, buf: Buffer) {
    let imageName: string;
    try {
        const xml2js = await import("xml2js");
        const xml = await parseXMLString(buf);
        imageName = xml.font.pages[0].page[0]["$"].file;
        const ext = extname(imageName);
        xml.font.pages[0].page[0]["$"].file = name + ext;
        const fntString = new xml2js.Builder({
            trim: true
        }).buildObject(xml);
        compilation.emitAsset(name + ".fnt", new wp.sources.RawSource(fntString, true));
        debug(`[bitmap font - xml] ${key}`);
    }
    catch (e) {
        return null;
    }
    return imageName;
}

/**
 * @hidden
 */
async function modifyBitmapFontText(key: string, name: string, assets: Assets, compilation: Compilation, stream: Readable) {
    return new bb<string>(resolve => {
        const rl = createInterface(stream);
        let imageName: string;
        const lines: string[] = [];
        let pageExists = false;
        rl.on("line", (line: string) => {
            if (_.startsWith(line, "page")) {
                const s = line.split("file=");
                imageName = JSON.parse(s[1]);
                const ext = extname(imageName);
                s[1] = `"${name}${ext}"`;
                line = s.join("file=");
                pageExists = true;
            }
            lines.push(line);
        });
        rl.on("close", () => {
            if (!pageExists) {
                resolve(null);
                return;
            }
            debug(`[bitmap font - text] ${key}`);
            const atlas = lines.join("\n");
            compilation.emitAsset(name + ".fnt", new wp.sources.RawSource(atlas, false));
            resolve(imageName);
        });
    });
}

/**
 * @hidden
 */
export async function processFonts(context: ProcessContext, compilation: Compilation, files: [FilesByType, Assets]): Promise<[FilesByType, Assets]> {
    const [toCopy, assets] = files;

    const fonts = toCopy["font"];
    delete toCopy["font"];

    debug("process fonts");

    for (const key of _.keys(fonts)) {
        const conf = fonts[key];
        const ext = conf.ext;
        let name = key;
        if (context.option.addHashToAsset) {
            name += `.${conf.hash}`;
        }
        const buf = await readFileAsync(conf.srcFile);
        // bitmap font
        let imageName = await modifyBitmapFontXML(key, name, assets, compilation, buf);
        let bufferString: string = undefined;
        let isText = false;
        if (imageName === null) {
            try {
                bufferString = buf.toString("utf-8");
                isText = true;
            }
            catch (e) {
                // no text
            }
            if (isText) {
                let json: any = undefined;
                try {
                    json = JSON.parse(bufferString);
                    isText = false;
                    if (isBitmap(json)) {
                        await renderBitmapFont(key, name, assets, context, compilation, json);
                    }
                    else {
                        // webfont
                        debug(`[web font - config] ${key}`);
                        _.set(assets, ["webfont", key], {
                            args: json
                        });
                    }
                }
                catch (e) {
                    compilation.warnings.push(e.toString());
                }
            }
        }
        if (isText) {
            if (imageName === null) {
                const { ReadableStreamBuffer } = await import("stream-buffers");
                const stream = new ReadableStreamBuffer();
                stream.put(bufferString);
                imageName = await modifyBitmapFontText(key, name, assets, compilation, stream);
                stream.stop();
            }
            if (imageName === null) {
                debug(`[web font - css] ${key}`);
                _.set(assets, ["webfont", key], {
                    args: {
                        custom: {
                            families: [key],
                            urls: [name + ".css"]
                        }
                    }
                });
                if (context.isChanged(compilation, conf.srcFile)) {
                    compilation.emitAsset(name + ".css", new wp.sources.RawSource(bufferString));
                }
            }
        }
        if (imageName !== null) {
            const imgPath = join(dirname(conf.srcFile), imageName);
            const imgExt = extname(imageName);
            conf.outType = "bitmapFont";
            _.set(assets, ["bitmapFont", key], {
                args: [name + imgExt, name + ".fnt"]
            });
            if (context.isChanged(compilation, imgPath)) {
                const img = await readFileAsync(imgPath);
                compilation.emitAsset(name + imgExt, new wp.sources.RawSource(img));
            }
        }
    }

    return files;
}
