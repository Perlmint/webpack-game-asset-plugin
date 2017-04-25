import { load } from "cheerio";
import * as gm from "gm";
import * as bb from "bluebird";
import * as _ from "lodash";
import { tmpFile, readFileAsync, debug } from "./util";

const template = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title></title>
  </head>
  <body></body>
</html>`;
const cssTemplate = `
html {
  -ms-touch-action: none;
  touch-action: none;
}
body {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    margin: 0;
    cursor: default;
    text-align: center;
    display: flex;
    flex-direction: column;
}
body, canvas, div {
  display: block;
  outline: none;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
  -moz-user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
  -khtml-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
}
`;

export interface Option {
    title: string;
    entryName?: string; // default index.html
    fullscreen?: boolean; // default true
    orientation?: "portrait" | "landscape"; // default portrait
    viewport?: number | "device"; // default device, width - landscape, height - portrait, because this is for game.
    scale?: {
        initial?: number; // default 1
        scalable?: boolean; // default false
        minimum?: number; // default not set
        maximum?: number; // default not set
    };
    backgroundColor?: string; // default not set
    themeColor?: string; // default not set
    icon?: string; // default not set
}

export function generateEntry(prefix: string, entryJS: string, option: Option) {
    debug("Generate Entry html");
    const ret: {[key: string]: string | Buffer} = {};
    const androied_manifest: any = {};
    const $ = load(template);

    if (option.entryName === undefined) {
        option.entryName = "index.html";
    }
    androied_manifest.start_url = option.entryName;

    $("title").text(option.title);
    $("head").append(`<meta name="apple-mobile-web-app-title" content="${option.title}" />`);
    androied_manifest.name = option.title;

    if (option.fullscreen !== false) {
        option.fullscreen = true;
    }
    if (option.fullscreen) {
        $("head").append("<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">");
        $("head").append("<meta name=\"mobile-web-app-capable\" content=\"yes\" />");
        androied_manifest.display = "standalone";
    }

    if (option.orientation === undefined) {
        option.orientation = "portrait";
    }
    if (option.viewport === undefined) {
        option.viewport = "device";
    }
    if (option.scale === undefined) {
        option.scale = {
            initial: 1.0,
            scalable: false
        };
    }
    androied_manifest.orientation = option.orientation;
    const scalableStr = option.scale.scalable ? "yes" : "no";
    let viewportString = `initial-scale=${option.scale.initial},user-scalable=${scalableStr}`;
    const orientationTarget = option.orientation === "portrait" ? "height" : "width";
    viewportString += `,${orientationTarget}=${option.viewport}`;
    if (option.viewport === "device") {
        viewportString += `-${orientationTarget}`;
    }
    if (option.scale.maximum) {
        viewportString += `,maximum-scale=${option.scale.maximum}`;
    }
    if (option.scale.minimum) {
        viewportString += `,minimum-scale=${option.scale.minimum}`;
    }
    const viewport = $("head").append(`<meta name="viewport" content="${viewportString}" />`);
    let css = cssTemplate;
    if (option.backgroundColor) {
        css += `body { background-color: ${option.backgroundColor} }`;
        androied_manifest.background_color = option.backgroundColor;
    }
    $("head").append("<style type=\"text/css\"></style>");
    $("head style").text(css);
    $("head").append(`<script src="${prefix}${entryJS}"></script>`);
    $("head").append("<link rel=\"manifest\" href=\"android_manifest.json\">");

    if (option.themeColor) {
        androied_manifest.theme_color = option.themeColor;
        $("head").append(`<meta name="theme-color" content="${option.themeColor}" />`);
    }


    return new bb<void>(resolve => {
        if (option.icon) {
            debug("Generate icon");
            const icon = gm(option.icon);
            const android: {[key: string]: number} = {
                "36": 0.75,
                "48": 1.0,
                "72": 1.5,
                "96": 2.0,
                "144": 3.0,
                "192": 4.0
            };
            const ios: {[key: string]: string} = {
                "180": "phone@3",
                "120": "phone@2",
                "167": "padpro",
                "152": "pad"
            };
            const res = _.sortedUniq(_.sortBy(_.concat(_.keys(android), _.keys(ios))));
            icon.identify((error, info) => {
                const possible = _.filter(res, r => parseInt(r) <= info.size.width);
                return bb.map(possible, size => new bb<[string, Buffer]>((resolve, reject) => {
                    const tmp = tmpFile({
                        discardDescriptor: true
                    });
                    const s = parseInt(size);
                    icon.resize(s, s)
                        .write(tmp.name, err => {
                            if (err) {
                                reject(err);
                            }
                            readFileAsync(tmp.name).then(buf => {
                                tmp.removeCallback();
                                resolve([size, buf]);
                            });
                        });
                })).then(converteds => {
                    androied_manifest.icons = [];
                    for (const converted of converteds) {
                        const [size, buffer] = converted;
                        let name: string;
                        if (ios[size] !== undefined) {
                            name = `launch-icon-${ios[size]}.png`;
                            $("head").append(`<link rel="apple-touch-icon" sizes="${size}x${size}" href="${prefix}${name}" />`);
                        }
                        else {
                            name = `launch-icon-${android[size]}.png`;
                            androied_manifest.icons.push({
                                "src": prefix + name,
                                "size": `${size}x${size}`,
                                "type": "image/png",
                                "density": android[size]
                            });
                            $("head").append(`<link rel="icon" sizes="${size}x${size}" href="${prefix}${name}" />`);
                        }
                        ret[name] = buffer;
                    }
                }).then(resolve);
            });
        }
    }).then(() => {
        ret[option.entryName] = $.html();
        ret["android_manifest.json"] = JSON.stringify(androied_manifest);

        return ret;
    });
}
