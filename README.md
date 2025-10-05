# Ultimate Class Tool

Ultimate Class Tool is a lightweight web app for casual Super Smash Bros. Ultimate sessions. It helps groups spin up themed fighter pools for silly game modes without keeping paper lists or rolling dice. The idea came from a friend wishing they could configure a per tag 'random character filter' so they could avoid getting certain characters while playing random. And then the idea that Tenkaichi would benefit from this if we could let people pick classes of characters.

## What It Does

- Ships with a handful of pre-made classes ("Grunklies", "Fighties", etc.) so you can roll a fighter immediately.
- Select a class from the dropdown filter and then hit "Roll" (or press `R`) to pick a random fighter from that pool.
- Lets players design their own classes on the fly and store them in the browser via `localStorage`.
- Presents a grid preview of the active pool and a big "Roll" button that also responds to the `R` key for quick rerolls.
- Supports desktop browsers, but was made with mobile in mind; add it to an iOS home screen to launch it as a stand-alone shortcut labeled **ULT CLASSES**.

## Usage

1. Open `https://www.bbussell.com/UltimateClassTool/` (or your local build) in a modern browser.
2. Choose a class from the dropdown to filter the roster.
3. Hit **Roll** (or press `R`) to pick the next fighter for your casual mode.
4. Select **Custom Class** to create your own pool—tap portraits to include fighters, name the class, and save.
5. Use **Delete Custom Class** when you want to remove a saved custom pool. Saved pools live entirely in your browser, so nothing is uploaded or shared.

Typical use cases include party modes, draft wheels, stream incentives, and other casual formats where you want to keep the roster fresh without full competitive power balancing.

## Development

```bash
npm install       # install dependencies (only needed once)
npm run regen     # rebuild characters.json from the sprites in characters/
npm start         # serve the static site locally
```

By default the character generator looks for PNG portraits inside `characters/` (or `public/characters/`) named `fighterid_00.png`. Optional focus metadata comes from `character.json`, keeping portraits framed nicely.

## Deployment

The site is pure static content (HTML/CSS/JS). Deploy by uploading the repository contents to any static host (GitHub Pages, Netlify, Render static, etc.). If you host from GitHub Pages, make sure the root `index.html` is the copy that references the assets alongside it.

## Credits

- Character art and Super Smash Bros. Ultimate are properties of Nintendo / HAL Laboratory. This fan project is not affiliated with, endorsed by, or sponsored by Nintendo.
- Fighter portraits originate from the community asset pack: [joaorb64/StreamHelperAssets](https://github.com/joaorb64/StreamHelperAssets/).

Please respect Nintendo's intellectual property and the work of the asset creators when redistributing or modifying this project.

