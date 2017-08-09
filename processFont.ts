import * as bb from "bluebird";
import * as _ from "lodash";
import { Readable } from "stream";
import { extname, dirname, join, basename } from "path";
import { FilesByType, Assets, File, isBitmap, Fonts, BitmapFontConf, ProcessContext } from "./option";
import { debug, readFileAsync, parseXMLString } from "./util";
import { createInterface } from "readline";

/**
 * @hidden
 */
async function renderBitmapFont(key: string, assets: Assets, context: ProcessContext, conf: BitmapFontConf) {
    console.log(`[bitmap font - render] ${key}`);
    const { BitmapFont, Canvas, ImageFormat } = await import("bitmapfont");
    const ShelfPack = await import("@mapbox/shelf-pack");
    const cacheKey = `font_${key}`;
    const [imageName, fontInfoName] = [key + ".png", key + ".fnt"];
    _.set(assets, ["bitmapFont", key], {
        args: [imageName, fontInfoName]
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
    const pack = new ShelfPack(0, 0, { autoResize: true });
    let lineHeight = 0;
    const requests = chars.map((info, i) => {
        const chHeight = Math.ceil(info.y2 - info.y1);
        lineHeight = Math.max(lineHeight, chHeight);
        return {
            id: i,
            w: Math.ceil(info.x2 - info.x1) + conf.gap * 2,
            h: chHeight + conf.gap * 2
        };
    });
    const bins = pack.pack(requests);
    const canvas = new Canvas(pack.w + conf.gap, pack.h + conf.gap);
    const fntInfo = [`<font><info face="${key}" size="${font.size}" bold="0" italic="0" charset="" unicode="" stretchH="100" smooth="1" aa="1" padding="${conf.gap},${conf.gap},${conf.gap},${conf.gap}" spacing="0,0" outline="0"/><common lineHeight="${lineHeight}" base="0" scaleW="${pack.w + conf.gap * 2}" scaleH="${pack.h + conf.gap * 2}" pages="1" packed="0"/><pages><page id="0" file="${basename(imageName)}"/></pages><chars count="${bins.length}">`];
    for (const bin of bins) {
        const ch = chars[bin.id as number];
        font.draw(canvas, ch.ch, Math.ceil(bin.x - ch.x1 + conf.gap), Math.ceil(bin.y + ch.y2));
        fntInfo.push(`<char id="${ch.ch.charCodeAt(0)}" x="${bin.x}" y="${bin.y}" width="${bin.w - conf.gap}" height="${bin.h - conf.gap}" xoffset="${-ch.x1 | 0}" yoffset="${(ch.ascender - ch.y2 + ch.y1) | 0}" xadvance="${bin.w - conf.gap * 2}" page="0" chnl="15"/>`);
    }
    fntInfo.push("</chars></font>");
    const imageBlob = canvas.blob(ImageFormat.PNG);
    context.compilation.assets[imageName] = {
        size: () => imageBlob.length,
        source: () => imageBlob
    };
    const fntInfoBuffer = new Buffer(fntInfo.join(""), "utf-8");
    context.compilation.assets[fontInfoName] = {
        size: () => fntInfoBuffer.length,
        source: () => fntInfoBuffer
    };
}

/**
 * @hidden
 */
async function modifyBitmapFontXML(key: string, assets: Assets, context: ProcessContext, buf: Buffer) {
    let imageName: string;
    try {
        const xml2js = await import("xml2js");
        const xml = await parseXMLString(buf);
        imageName = xml.font.pages[0].page[0]["$"].file;
        const ext = extname(imageName);
        xml.font.pages[0].page[0]["$"].file = key + ext;
        const fntString = new xml2js.Builder({
            trim: true
        }).buildObject(xml);
        context.compilation.assets[key + ".fnt"] = {
            size: () => fntString.length,
            source: () => fntString
        };
        console.log(`[bitmap font - xml] ${key}`);
    }
    catch (e) {
        return null;
    }
    return imageName;
}

/**
 * @hidden
 */
async function modifyBitmapFontText(key: string, assets: Assets, context: ProcessContext, stream: Readable) {
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
                s[1] = `"${key}${ext}"`;
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
            console.log(`[bitmap font - text] ${key}`);
            const atlas = lines.join("\n");
            context.compilation.assets[key + ".fnt"] = {
                size: () => atlas.length,
                source: () => atlas
            };
            resolve(imageName);
        });
    });
}

/**
 * @hidden
 */
export async function processFonts(context: ProcessContext, files: [FilesByType, Assets]): bb<[FilesByType, Assets]> {
    const [toCopy, assets] = files;

    const fonts = toCopy["font"];
    delete toCopy["font"];

    debug("process fonts");

    for (const key of _.keys(fonts)) {
        const conf = fonts[key];
        const ext = conf.ext;
        const buf = await readFileAsync(conf.srcFile);
        // bitmap font
        let imageName = await modifyBitmapFontXML(key, assets, context, buf);
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
                        await renderBitmapFont(key, assets, context, json);
                    }
                    else {
                        // webfont
                        console.log(`[web font - config] ${key}`);
                        _.set(assets, ["webfont", key], {
                            args: json
                        });
                    }
                }
                catch (e) {

                }
            }
        }
        if (isText) {
            if (imageName === null) {
                const { ReadableStreamBuffer } = await import("stream-buffers");
                const stream = new ReadableStreamBuffer();
                stream.put(bufferString);
                imageName = await modifyBitmapFontText(key, assets, context, stream);
                stream.stop();
            }
            if (imageName === null) {
                console.log(`[web font - css] ${key}`);
                _.set(assets, ["webfont", key], {
                    args: {
                        custom: {
                            families: [key],
                            urls: [key + ".css"]
                        }
                    }
                });
                if (context.isChanged(conf.srcFile)) {
                    context.compilation.assets[key + ".css"] = {
                        size: () => bufferString.length,
                        source: () => bufferString
                    };
                }
            }
        }
        if (imageName !== null) {
            const imgPath = join(dirname(conf.srcFile), imageName);
            const imgExt = extname(imageName);
            _.set(assets, ["bitmapFont", key], {
                args: [key + imgExt, key + ".fnt"]
            });
            if (context.isChanged(imgPath)) {
                const img = await readFileAsync(imgPath);
                context.compilation.assets[key + imgExt] = {
                    size: () => img.length,
                    source: () => img
                };
            }
        }
    }

    return files;
}
