import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const charactersDir = path.join(projectRoot, 'public', 'characters');
const outputPath = path.join(projectRoot, 'public', 'characters.json');
const configPath = path.join(projectRoot, 'mural_art', 'config.json');

const FILENAME_PATTERN = /^(?<id>[a-z0-9_]+)_00\.png$/i;

async function main() {
  const { eyesights, warnings } = await loadEyesightData();
  const missingFocus = new Set();

  try {
    const entries = await fs.readdir(charactersDir, { withFileTypes: true });
    const characters = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => FILENAME_PATTERN.test(name))
      .map((name) => {
        const match = name.match(FILENAME_PATTERN);
        const id = match?.groups?.id ?? '';
        const focus = getFocusPoint(eyesights, id);
        if (!focus) {
          missingFocus.add(id.toLowerCase());
        }
        const character = {
          id: id.toLowerCase(),
          file: path.posix.join('characters', name),
        };
        if (focus) {
          character.focus = focus;
        }
        return character;
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    const json = JSON.stringify(characters, null, 2);
    await fs.writeFile(outputPath, `${json}\n`, 'utf8');
    console.log(`Generated ${characters.length} characters to ${path.relative(projectRoot, outputPath)}`);
    if (warnings.length) {
      warnings.forEach((msg) => console.warn(msg));
    }
    if (missingFocus.size) {
      console.warn(`Missing eyesight data for: ${Array.from(missingFocus).join(', ')}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('characters directory not found. Ensure public/characters exists.');
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function getFocusPoint(eyesights, id) {
  const entry = eyesights.get(id.toLowerCase());
  if (!entry) {
    return null;
  }
  const focus = entry.get('0') ?? entry.values().next()?.value;
  if (!focus) {
    return null;
  }
  const x = Number(focus.x);
  const y = Number(focus.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

async function loadEyesightData() {
  const warnings = [];
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    const eyesights = config?.eyesights ?? {};
    const map = new Map();
    for (const [id, variants] of Object.entries(eyesights)) {
      map.set(id.toLowerCase(), new Map(Object.entries(variants)));
    }
    return { eyesights: map, warnings };
  } catch (error) {
    if (error.code === 'ENOENT') {
      warnings.push('config.json not found. Proceeding without eyesight data.');
      return { eyesights: new Map(), warnings };
    }
    warnings.push(`Failed to parse eyesight data: ${error.message}`);
    return { eyesights: new Map(), warnings };
  }
}

main();
