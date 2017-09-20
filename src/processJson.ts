import * as bb from "bluebird";
import * as _ from "lodash";
import { fromPairs, clone, keys } from "lodash";
import { join } from "path";
import { readFileAsync } from "./util";
import { FilesByType, Assets, ProcessContext } from "./option";
import { createHash } from "crypto";

/**
 * @hidden
 */
export async function processJson(context: ProcessContext, files: [FilesByType, Assets]): Promise<[FilesByType, Assets]> {
    const [toCopy, assets] = files;
    const jsonFiles = toCopy["json"];
    delete toCopy["json"];
    delete assets["json"];

    if (!_.some(_.values(jsonFiles), file => context.isChanged(file.srcFile))) {
        return [toCopy, assets];
    }

    const grouped = _.groupBy(jsonFiles, o => _.reduce(
        _.sortBy(o.referencedModules),
        (hash, val) => hash.update(val),
        createHash("md5")).digest("hex")
    );
    await bb.all(_.map(grouped, async (files, groupName) => {
        const filenames = _.sortBy(_.map(files, f => f.name));
        const hash = createHash("md5");
        const data = await bb.map(
            filenames,
            async (name) => {
                let data: string;
                if (jsonFiles[name].data) {
                    data = jsonFiles[name].data;
                }
                else {
                    const buf = await readFileAsync(context.toAbsPath(jsonFiles[name].srcFile));
                    hash.update(buf);
                    data = buf.toString("utf-8");
                }
                return [name, JSON.parse(data)] as [string, any];
            }
        );
        const hashStr = hash.digest("hex");
        let outName = groupName;
        if (context.option.addHashToAsset) {
            outName += `.${hashStr}`;
        }
        const filename = `${outName}.json`;
        assets["mergedjson"] = {
            filename: {
                ext: ".json",
                name: filename,
                outFile: filename,
                hash: hashStr,
                localized: [""],
                srcFile: ""
            }
        };
        for (const name of filenames) {
            jsonFiles[name].outName = outName;
            jsonFiles[name].outType = "mergedjson";
            jsonFiles[name].outFile = filename;
        }
        const merged = await fromPairs(data);
        const stringified = JSON.stringify(merged);
        context.compilation.assets[filename] = {
            size: () => stringified.length,
            source: () => stringified
        };
    }));

    return [toCopy, assets];
}
