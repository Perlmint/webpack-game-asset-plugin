import * as wp from "webpack";
import * as bb from "bluebird";
import * as _ from "lodash";
import { extname, dirname, join } from "path";
import { InternalOption, FilesByType, Assets, File } from "./option";
import { debug, readFileAsync, parseXMLString } from "./util";
import * as xml2js from "xml2js";
import { createInterface } from "readline";
import { ReadableStreamBuffer } from "stream-buffers";

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
