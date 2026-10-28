'use strict';
// Homebrew Channel manifest for the built IPK: repo.webosbrew.org reads it through the catalog's manifestUrl
// (releases/latest/download/<id>.manifest.json), then downloads ipkUrl and checks ipkHash before installing.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const SLUG = process.env.GITHUB_REPOSITORY || 'steam20011972-code/tv-vpn',
  REPO = 'https://github.com/' + SLUG;
function manifest(dir = 'dist') {
  const { id, version, type, title, appDescription } = require('../app/appinfo.json'),
    file = `${id}_${version}_all.ipk`;
  const ipk = fs.readFileSync(path.join(dir, file)),
    sum = fs
      .readFileSync(path.join(dir, file + '.sha256'), 'utf8')
      .trim()
      .split(/\s+/);
  // The hash written by tools/build.cjs must describe this very file, or Homebrew Channel refuses the download.
  if (sum[1] !== file || sum[0] !== crypto.createHash('sha256').update(ipk).digest('hex'))
    throw Error(file + '.sha256 does not match ' + file);
  // Pinned to the tag, so an older manifest never points at a newer package.
  return {
    id,
    version,
    type,
    title,
    appDescription,
    iconUri: `https://raw.githubusercontent.com/${SLUG}/v${version}/app/icon.png`,
    sourceUrl: REPO,
    rootRequired: true,
    ipkUrl: `${REPO}/releases/download/v${version}/${file}`,
    ipkHash: { sha256: sum[0] },
    ipkSize: ipk.length,
  };
}
if (require.main === module) {
  try {
    const dir = process.argv[2] || 'dist',
      m = manifest(dir),
      out = path.join(dir, m.id + '.manifest.json');
    fs.writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
    console.log('Wrote ' + out);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { manifest };
