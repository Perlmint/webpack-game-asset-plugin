import * as bb from "bluebird";
import * as _ from "lodash";
import { fromPairs, clone, keys } from "lodash";
import { join } from "path";
import { readFileAsync } from "./util";
import { FilesByType, Assets, ProcessContext } from "./option";

/**
 * @hidden
 */
export async function processJson(context: ProcessContext, files: [FilesByType, Assets]): Promise<[FilesByType, Assets]> {
    const [toCopy, assets] = files;
    const jsonFiles = toCopy["json"];
    assets["mergedjson"] = {
        "data.json": {
            ext: ".json",
            name: "data.json",
            outFile: "data.json",
            srcFile: ""
        }
    };
    delete toCopy["json"];
    delete assets["json"];

    if (!_.some(_.values(jsonFiles), file => context.isChanged(file.srcFile))) {
        return [toCopy, assets];
    }

    const data = await bb.map(
        keys(jsonFiles),
        async (filename) => {
            let data: string;
            if (jsonFiles[filename].data) {
                 data = jsonFiles[filename].data;
            }
            else {
                data = await readFileAsync(context.toAbsPath(jsonFiles[filename].srcFile)).then(
                    buf => buf.toString("utf-8")
                );
            }
            return [filename, JSON.parse(data)];
        }
    );
    const merged = await fromPairs(data);
    const stringified = JSON.stringify(merged);
    context.compilation.assets["data.json"] = {
        size: () => stringified.length,
        source: () => stringified
    };

    return [toCopy, assets];
}
