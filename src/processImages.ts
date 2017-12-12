import * as wp from "webpack";
import * as bb from "bluebird";
import * as _ from "lodash";
import { parse as parsePath, format as formatPath, dirname, resolve as resolvePath } from "path";
import { InternalOption, FilesByType, File, isFile, Assets, ProcessContext, AtlasMapType } from "./option";
import { localJoinPath, tmpFile, SynchrounousResult, readFileAsync, debug } from "./util";
import { stylesheet } from "./stylesheet";
import { createHash } from "crypto";
import * as Packer from "maxrects-packer";
import { sync as globSync } from "glob";

/**
 * @hidden
 */
interface SourceTree<T>  {
    files?: {[name: string]: T};
    dirs?: {[name: string]: SourceTree<T>};
}

/**
 * @hidden
 */
interface Size {
    width: number;
    height: number;
}

/**
 * @hidden
 */
async function getImageSize(path: string) {
    const gm = await import("gm");
    return new Promise<Size>((resolve, reject) => gm(path).size((e, v) => {
        if (e != null) {
            return reject(e);
        }
        resolve({
            width: v.width,
            height: v.height
        });
    }));
}

/**
 * @hidden
 */
async function packImages(width: number, height: number, padding: number, tree: SourceTree<File & Size>, priorSize: boolean) {
    let pack: Packer = new Packer(width, height, padding);
    let name: string[] = [];
    while (true) {
        if (tree.files !== undefined) {
            break;
        }
        if (tree.dirs === undefined) {
            break;
        }
        if (_.size(tree.dirs) !== 1) {
            break;
        }
        name.push(_.keys(tree.dirs)[0]);
        tree = _.values(tree.dirs)[0];
    }

    const queue: [SourceTree<File & Size>, string][] = [[tree, `sub.${name.join("/")}`]];
    if (priorSize) {
        let items: (File & Size)[] = [];
        while (queue.length !== 0) {
            const [node, name] = queue.pop();
            if (node.dirs !== undefined) {
                queue.push(..._.map(
                    node.dirs,
                    (o, k) => [o, `${name}.sub.${k}`] as [SourceTree<File & Size>, string]
                ));
            }
            if (node.files !== undefined) {
                // leaf node
                items = items.concat(_.values(node.files));
            }
        }

        items = _.reverse(_.sortBy(items, i => i.width * i.height));
        pack.addArray(_.map(items, f => ({
            data: f.srcFile,
            width: f.width,
            height: f.height
        })));
    } else {
        while (queue.length !== 0) {
            const [node, name] = queue.pop();
            if (node.dirs !== undefined) {
                queue.push(..._.map(
                    node.dirs,
                    (o, k) => [o, `${name}.sub.${k}`] as [SourceTree<File & Size>, string]
                ));
            }
            if (node.files !== undefined) {
                // leaf node
                let files = _.map(node.files, f => ({
                    data: f.srcFile,
                    width: f.width,
                    height: f.height
                }));
                pack.addArray(files);
            }
        }
    }

    return pack;
}

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

    const groupMap = await option.atlasMap(context.context);
    const groupRevMap: {[path: string]: string} = {};
    _.forEach(groupMap, (paths, groupName) => {
        for (const path of paths) {
            for (const found of globSync(path)) {
                groupRevMap[resolvePath(found)] = groupName;
            }
        }
    });

    debug("generate atlas");

    const excludes = _.keys(images).filter(img => _.find(groupMap.excludes, e => _.startsWith(img, e)));
    for (const key of excludes) {
        toCopy["image"][key] = images[key];
        delete images[key];
    }

    let binFileMap: {[key: string]: File} = {};
    let localizeds: {[language: string]: SourceTree<File & Size>} = {};
    const groups: {[key: string]: SourceTree<File & Size>} = {};
    // make source image tree based on location
    await bb.all(_.map(images, async (file, key) => {
        // do not pack
        if (file.query["raw"]) {
            toCopy["image"][key] = file;

            return;
        }
        // oversize!
        const size = await getImageSize(file.srcFile);
        if (size.width > option.atlasOption.width || size.height > option.atlasOption.height) {
            toCopy["image"][key] = file;

            return;
        }
        const path = ["dirs"].concat(dirname(file.srcFile).replace(/\\/g, "/").replace(/\//g, "/dirs/").split("/").concat(["files"]));

        // has localized resource
        if (file.localized.length > 1) {
            for (let lang of file.localized) {
                const parsedPath = parsePath(file.srcFile);
                if (lang !== "") {
                    lang = `@${lang}`;
                }

                const localizedSrc = localJoinPath(parsedPath.dir, `${parsedPath.name}${lang}${parsedPath.ext}`);
                _.setWith(localizeds, _.concat(["dirs", lang], ...path), _.defaults({
                    srcFile: localizedSrc
                }, file, await getImageSize(localizedSrc)), Object);
            }
            return;
        }

        const group = _.defaultTo(file.query["group"], _.defaultTo(groupRevMap[file.srcFile], ""));
        if (!groups[group]) {
            groups[group] = {};
        }
        let node: any[] = _.get(groups[group], path);
        if (node === undefined) {
            node = [];
            _.setWith(groups[group], path, node, Object);
        }
        binFileMap[file.srcFile] = file;
        node.push(Object.assign(file, size));
    }));

    const packs = await bb.map(
        _.sortBy(_.toPairs(groups), g => g[0]),
        group => packImages(option.atlasOption.width, option.atlasOption.height, option.atlasOption.padding, group[1], group[0] !== "")
    );
    const bins = _.reduce<Packer, Packer.Bin[]>(packs, (prev, pack) => prev.concat(pack.bins), []);

    await bb.all(_.map(bins, (bin, idx) => new bb(async (resolve, reject) => {
        try {
            const outName = idx.toString(10);

            const gm = await import("gm");
            const img = gm(bin.width, bin.height, "#FFFFFFFF");
            for (const rect of bin.rects) {
                (img as any).in(
                    "-geometry", `${rect.width}x${rect.height}`
                ).in(
                    "-page", `+${rect.x}+${rect.y}`
                ).in(
                    rect.data
                );
            }
            img.mosaic();

            img.toBuffer("PNG", async (e, buffer) => {
                if (e != null) {
                    return reject(e);
                }

                const frameInfo = {
                    frames: _.fromPairs(_.map(
                        bin.rects,
                        src => {
                            const file = binFileMap[src.data];
                            return [file.name, {
                                frame: {
                                    h: src.height,
                                    w: src.width,
                                    x: src.x,
                                    y: src.y
                                },
                                rotated: false,
                                sourceSize: {
                                    h: src.height,
                                    w: src.width
                                },
                                spriteSourceSize: {
                                    x: 0,
                                    y: 0,
                                    h: src.height,
                                    w: src.width
                                },
                                trimmed: false
                            }];
                        })
                    ),
                    meta: {
                        image: outName + ".png",
                        scale: 1,
                        size: {
                            w: bin.width,
                            h: bin.height
                        }
                    }
                };
                for (const src of bin.rects) {
                    const file = binFileMap[src.data];
                    file.outFile = [outName + ".png", outName + ".json"];
                    file.outName = outName;
                    file.outType = "atlas";
                }
                let hashStr: string;
                const hash = createHash("md5");
                hash.update(buffer);
                hashStr = hash.digest("hex");
                context.compilation.assets[outName + ".png"] = {
                    size: () => buffer.length,
                    source: () => buffer
                };
                const frameInfoStr = JSON.stringify(frameInfo);
                context.compilation.assets[outName + ".json"] = {
                    size: () => frameInfoStr.length,
                    source: () => frameInfoStr
                };
                assets["atlas"][outName] = {
                    ext: ".png",
                    name: outName,
                    hash: hashStr,
                    outFile: [outName + ".png", outName + ".json"],
                    args: undefined,
                    srcFile: ""
                };
                resolve();
            });
        } catch (e) {
            reject(e);
        }
    })));

    return [toCopy, assets];
}
