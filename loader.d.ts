declare module "game-asset!*" {
    const assetID: string;
    export const path: string;
    export default assetID;
}
declare module "game-asset-glob!*" {
    const assets: {[key: string]: typeof import('game-asset!*').default};
    export default assets;
}
declare module "game-asset?*" {
    import * as i from 'game-asset!*';
    export = i;
}
