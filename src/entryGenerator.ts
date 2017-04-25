import { load } from "cheerio";

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
}

export function generateEntry(entryJS: string, option: Option) {
    const ret: {[key: string]: string} = {};
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
    }
    $("head").append("<style type=\"text/css\"></style>");
    $("head style").text(css);
    $("head").append(`<script src="${entryJS}"></script>`);
    $("head").append("<link rel=\"manifest\" href=\"android_manifest.json\">");

    ret[option.entryName] = $.html();
    ret["android_manifest.json"] = JSON.stringify(androied_manifest);

    return ret;
}
