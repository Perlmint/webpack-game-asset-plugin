import * as wp from "webpack";
import * as bb from "bluebird";
import * as _ from "lodash";
import { extname, dirname, join } from "path";
import { InternalOption, FilesByType, Assets, File, isBitmap } from "./option";
import { debug, readFileAsync, parseXMLString } from "./util";
import * as xml2js from "xml2js";
import { createInterface } from "readline";
import { ReadableStreamBuffer } from "stream-buffers";
import { BitmapFont, Canvas, ImageFormat } from "bitmapfont";
import * as ShelfPack from "@mapbox/shelf-pack";

/**
 * @hidden
 */
export function processFonts(context: string, option: InternalOption, compilation: wp.Compilation, files: [FilesByType, Assets]): bb<[FilesByType, Assets]> {
    const [toCopy, assets] = files;

    debug("process fonts");

    return option.fonts().then(fonts => bb.all(_.map(fonts, (conf, key) => {
        debug(conf);
        if (typeof conf === "string") {
            const ext = extname(conf);
            // bitmap font
            if (ext === ".fnt") {
                return readFileAsync(conf).then(
                    buf => parseXMLString(buf).then(xml => {
                        const imageName = xml.font.pages[0].page[0]["$"].file;
                        const ext = extname(imageName);
                        xml.font.pages[0].page[0]["$"].file = key + ext;
                        const fntString = new xml2js.Builder({
                            trim: true
                        }).buildObject(xml);
                        compilation.assets[key + ".fnt"] = {
                            size: () => fntString.length,
                            source: () => fntString
                        };
                        return imageName;
                    }).error(e => new bb<string>(resolve => {
                        const stream = new ReadableStreamBuffer();
                        stream.put(buf);
                        const rl = createInterface(stream);
                        let imageName: string;
                        const lines: string[] = [];
                        rl.on("line", (line: string) => {
                            if (_.startsWith(line, "page")) {
                                const s = line.split("file=");
                                imageName = JSON.parse(s[1]);
                                const ext = extname(imageName);
                                s[1] = `"${key}${ext}"`;
                                line = s.join("file=");
                            }
                            lines.push(line);
                        });
                        rl.on("close", () => {
                            const atlas = lines.join("\n");
                            compilation.assets[key + ".fnt"] = {
                                size: () => atlas.length,
                                source: () => atlas
                            };
                            resolve(imageName);
                        });
                        stream.stop();
                    }))
                ).then(imageName => readFileAsync(join(dirname(conf), imageName)).then(
                    img => {
                        const ext = extname(imageName);
                        compilation.assets[key + ext] = {
                            size: () => img.length,
                            source: () => img
                        };
                        return ext;
                    }
                )).then(imgExt => {
                    if (assets["bitmapFont"] === undefined) {
                        assets["bitmapFont"] = {};
                    }
                    assets["bitmapFont"][key] = {
                        args: [key + imgExt, key + ".fnt"]
                    };
                });
            }
            else if (ext === ".css") {
                return readFileAsync(conf).then(css => {
                    if (assets["webfont"] === undefined) {
                        assets["webfont"] = {};
                    }
                    compilation.assets[key + ".css"] = {
                        size: () => css.length,
                        source: () => css
                    };
                    assets["webfont"][key] = {
                        args: {
                            custom: {
                                families: [key],
                                urls: [key + ".css"]
                            }
                        }
                    };
                });
            }
        }
        else if (isBitmap(conf)) {
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
                } as ShelfPack.RequestShort;
            });
            const bins = pack.pack(requests);
            const canvas = new Canvas(pack.w + conf.gap, pack.h + conf.gap);
            const [imageName, fontInfoName] = [key + ".png", key + ".fnt"];
            const fntInfo = [`<font><info face="${font.family}" size="${font.size}" bold="0" italic="0" charset="" unicode="" stretchH="100" smooth="1" aa="1" padding="${conf.gap},${conf.gap},${conf.gap},${conf.gap}" spacing="0,0" outline="0"/><common lineHeight="${lineHeight}" base="0" scaleW="${pack.w + conf.gap * 2}" scaleH="${pack.h + conf.gap * 2}" pages="1" packed="0"/><pages><page id="0" file="${imageName}"/></pages><chars count="${bins.length}">`];
            for (const bin of bins) {
                const ch = chars[bin.id as number];
                font.draw(canvas, ch.ch, Math.ceil(bin.x - ch.x1 + conf.gap), Math.ceil(bin.y + ch.y2));
                fntInfo.push(`<char id="${ch.ch.charCodeAt(0)}" x="${bin.x}" y="${bin.y}" width="${bin.w - conf.gap}" height="${bin.h - conf.gap}" xoffset="${-ch.x1 | 0}" yoffset="${(ch.ascender - ch.y2 + ch.y1) | 0}" xadvance="${bin.w - conf.gap * 2}" page="0" chnl="15"/>`);
            }
            fntInfo.push("</chars></font>");
            const imageBlob = canvas.blob(ImageFormat.PNG);
            if (assets["bitmapFont"] === undefined) {
                assets["bitmapFont"] = {};
            }
            assets["bitmapFont"][key] = {
                args: [imageName, fontInfoName]
            };
            compilation.assets[imageName] = {
                size: () => imageBlob.length,
                source: () => imageBlob
            };
            const fntInfoBuffer = new Buffer(fntInfo.join(""), "utf-8");
            compilation.assets[fontInfoName] = {
                size: () => fntInfoBuffer.length,
                source: () => fntInfoBuffer
            };
        }
        else {
            // webfont
            if (assets["webfont"] === undefined) {
                assets["webfont"] = {};
            }
            assets["webfont"][key] = {
                args: conf
            };
        }
    }))).then(() => files);
}
