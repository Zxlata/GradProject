/**
 * generate-icons.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates all PWA PNG icons from the SVG source files.
 *
 * Primary engine : @resvg/resvg-js  (pure WASM – zero native build tools)
 * Fallback engine: sharp             (needs native libs, but faster)
 *
 * Run once after cloning or whenever you change the SVG source:
 *
 *   node scripts/generate-icons.js
 *
 * The script auto-installs the required package if it is missing.
 */

const path        = require('path');
const fs          = require('fs');
const { execSync} = require('child_process');

const ICONS_DIR  = path.resolve(__dirname, '..', 'public', 'icons');
const MASTER_SVG = path.join(ICONS_DIR, 'icon.svg');
const MASK_SVG   = path.join(ICONS_DIR, 'icon-maskable.svg');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

// ── Validation ────────────────────────────────────────────────────────────────

function validateSVG(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SVG source not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('<svg')) {
    throw new Error(`File does not appear to be a valid SVG: ${filePath}`);
  }
  console.log(`  ✔ validated ${path.basename(filePath)}`);
  return content;
}

// ── Auto-install helper ───────────────────────────────────────────────────────

function tryInstall(pkg) {
  try {
    require.resolve(pkg);
    return true;   // already installed
  } catch {
    console.log(`\n  📦 Installing ${pkg}…`);
    try {
      execSync(`npm install --save-dev ${pkg}`, {
        cwd:   path.resolve(__dirname, '..'),
        stdio: 'inherit',
      });
      return true;
    } catch (err) {
      console.error(`  ✘ Could not install ${pkg}: ${err.message}`);
      return false;
    }
  }
}

// ── resvg-js renderer ─────────────────────────────────────────────────────────

async function generateWithResvg(masterContent, maskContent) {
  const { Resvg } = require('@resvg/resvg-js');

  for (const size of SIZES) {
    const resvg = new Resvg(masterContent, {
      fitTo: { mode: 'width', value: size },
      font:  { loadSystemFonts: false },
    });
    const rendered = resvg.render();
    const png      = rendered.asPng();
    const outPath  = path.join(ICONS_DIR, `icon-${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`  ✔ icon-${size}.png  (${png.length} bytes)`);
  }

  // Maskable 512
  const resvgMask  = new Resvg(maskContent, {
    fitTo: { mode: 'width', value: 512 },
    font:  { loadSystemFonts: false },
  });
  const maskPng = resvgMask.render().asPng();
  const maskOut = path.join(ICONS_DIR, 'icon-512-maskable.png');
  fs.writeFileSync(maskOut, maskPng);
  console.log(`  ✔ icon-512-maskable.png  (${maskPng.length} bytes)`);
}

// ── sharp renderer (fallback) ─────────────────────────────────────────────────

async function generateWithSharp() {
  const sharp = require('sharp');

  for (const size of SIZES) {
    const outPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp(MASTER_SVG, { density: 300 })
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`  ✔ icon-${size}.png`);
  }

  const maskOut = path.join(ICONS_DIR, 'icon-512-maskable.png');
  await sharp(MASK_SVG, { density: 300 })
    .resize(512, 512)
    .png()
    .toFile(maskOut);
  console.log('  ✔ icon-512-maskable.png');
}

// ── Verify output ─────────────────────────────────────────────────────────────

function verifyOutput() {
  const expected = [
    ...SIZES.map(s => `icon-${s}.png`),
    'icon-512-maskable.png',
  ];
  let allOk = true;
  console.log('\n  Verifying output:');
  for (const name of expected) {
    const p = path.join(ICONS_DIR, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 100) {
      console.log(`    ✔ ${name}  (${fs.statSync(p).size} bytes)`);
    } else {
      console.error(`    ✘ ${name}  MISSING or empty!`);
      allOk = false;
    }
  }
  return allOk;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n🎨  PWA icon generator\n');

  // 1. Validate source SVGs
  console.log('  Validating SVG sources…');
  let masterContent, maskContent;
  try {
    masterContent = validateSVG(MASTER_SVG);
    maskContent   = validateSVG(MASK_SVG);
  } catch (err) {
    console.error(`\n✘  ${err.message}\n`);
    process.exit(1);
  }

  // 2. Try @resvg/resvg-js (primary – pure WASM, no native build needed)
  console.log('\n  Trying @resvg/resvg-js (primary engine)…');
  const resvgAvailable = tryInstall('@resvg/resvg-js');

  if (resvgAvailable) {
    try {
      await generateWithResvg(masterContent, maskContent);
      if (verifyOutput()) {
        console.log('\n✅  All icons generated successfully (via @resvg/resvg-js).\n');
        return;
      }
    } catch (err) {
      console.error(`\n  @resvg/resvg-js failed: ${err.message}`);
      if (err.stack) console.error(err.stack);
    }
  }

  // 3. Fallback: sharp
  console.log('\n  Trying sharp (fallback engine)…');
  const sharpAvailable = tryInstall('sharp');

  if (sharpAvailable) {
    try {
      await generateWithSharp();
      if (verifyOutput()) {
        console.log('\n✅  All icons generated successfully (via sharp).\n');
        return;
      }
    } catch (err) {
      console.error(`\n  sharp failed: ${err.message}`);
      if (err.stack) console.error(err.stack);
    }
  }

  // 4. Both failed
  console.error(`
✘  Could not generate PNG icons automatically.

Manual fallback:
  1. Open https://svgtopng.com/ (or any SVG → PNG converter)
  2. Upload:  public/icons/icon.svg
  3. Export at each size:  72, 96, 128, 144, 152, 192, 384, 512
  4. Save as:  public/icons/icon-<size>.png
  5. Separately convert icon-maskable.svg → public/icons/icon-512-maskable.png

Or try:
  npm install --save-dev @resvg/resvg-js
  node scripts/generate-icons.js
`);
  process.exit(1);
})();
