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

    const filenames = _.sortBy(keys(jsonFiles));
    const hash = createHash("md5");
    const data = await bb.map(
        filenames,
        async (filename) => {
            let data: string;
            if (jsonFiles[filename].data) {
                 data = jsonFiles[filename].data;
            }
            else {
                const buf = await readFileAsync(context.toAbsPath(jsonFiles[filename].srcFile));
                hash.update(buf);
                data = buf.toString("utf-8");
            }
            return [filename, JSON.parse(data)] as [string, any];
        }
    );
    const hashStr = hash.digest("hex");
    const filename = `${hashStr}.data.json`;
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
    const merged = await fromPairs(data);
    const stringified = JSON.stringify(merged);
    context.compilation.assets[filename] = {
        size: () => stringified.length,
        source: () => stringified
    };

    return [toCopy, assets];
}
