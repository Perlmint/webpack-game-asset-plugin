import * as wp from "webpack";
import * as bb from "bluebird";
import * as _ from "lodash";
import { InternalOption, FilesByType, File, Assets, ProcessContext, AtlasMapType } from "./option";
import { localJoinPath, tmpFile, SynchrounousResult, readFileAsync, debug } from "./util";
import { stylesheet } from "./stylesheet";
import { createHash } from "crypto";

/**
 * @hidden
 */
export async function processImages(context: ProcessContext, option: InternalOption, files: [FilesByType, Assets]): Promise<[FilesByType, Assets]> {
    const [toCopy, assets] = files;

    const images = toCopy["image"];
    toCopy["image"] = {};
    delete assets["image"];
    assets["atlas"] = {};
    let idx = 0;

    const map = await option.atlasMap(context.context);

    debug("generate atlas");

    const excludes = _.keys(images).filter(img => _.find(map.excludes, e => _.startsWith(img, e)));
    for (const key of excludes) {
        toCopy["image"][key] = images[key];
        delete images[key];
    }
    const sources: {[key: string]: [string, File][]} = {};
    _.forEach(images, (file, key) => {
        for (const pfxkv of map.pack) {
            const { name: pfx, group: idx } = pfxkv;
            if (!_.startsWith(key, pfx)) {
                continue;
            }
            if (file.query["raw"]) {
                continue;
            }

            if (sources[idx] === undefined) {
                sources[idx] = [];
            }
            sources[idx].push([key, file]);
            break;
        }
    });

    await bb.all(_.map(sources, (source, outName) => new bb(async (resolve, reject) => {
        try {
            if (source.length <= 1) {
                for (const file of source) {
                    toCopy["image"][file[0]] = file[1];
                }
                resolve();
                return;
            }
            const [atlas, info] = [".png", ".json"].map(postfix => tmpFile({
                postfix,
                discardDescriptor: true
            }));
            const imgSrcs = _.fromPairs(
                source.map(
                    src => [src[1].srcFile, src[0]]
                )
            );

            const nsg = await import("node-sprite-generator");

            nsg({
                src: _.keys(imgSrcs),
                compositor: option.compositor,
                layout: "packed",
                spritePath: atlas.name,
                stylesheetPath: info.name,
                stylesheet: (layout: NodeSpriteGenerator.Layout, stylesheetPath: string, spritePath: string, options: NodeSpriteGenerator.Option, callback: (error: Error) => void) => stylesheet(outName + ".png", imgSrcs, layout, stylesheetPath, spritePath, options, callback),
                layoutOptions: {
                    padding: option.atlasOption.padding || 0
                }
            }, async (e): Promise<void> => {
                if (e == null) {
                    for (const src of source) {
                        src[1].outFile = [outName + ".png", outName + ".json"];
                        src[1].outName = outName;
                        src[1].outType = "atlas";
                    }
                    try {
                        let hashStr: string;
                        await bb.all(
                            _.map<[SynchrounousResult , string], bb<void>>(
                                [[atlas, ".png"], [info, ".json"]],
                                names =>
                                    readFileAsync(names[0].name).then(content => {
                                        const hash = createHash("md5");
                                        hash.update(content);
                                        hashStr = hash.digest("hex");
                                        context.compilation.assets[outName + names[1]] = {
                                            size: () => content.length,
                                            source: () => content
                                        };
                                        names[0].removeCallback();
                                    })
                            )
                        );
                        assets["atlas"][outName] = {
                            ext: ".png",
                            name: outName,
                            hash: hashStr,
                            outFile: [outName + ".png", outName + ".json"],
                            srcFile: ""
                        };
                        resolve();
                    }
                    catch (error) {
                        debug("Error occured while register generated atlas as assets");
                        reject(error);
                    }
                } else {
                    debug("Error occured while atlas generating");
                    reject(e);
                }
            });
        } catch (e) {
            reject(e);
        }
    })));

    return [toCopy, assets];
}
