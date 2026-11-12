// Fetches the MakeGood kit pack listed in kitpacks/index.json into the preview's own folder,
// verified against the sha256 and size in the index. Nothing here is ever committed
// (.gitignore blocks *.kitpack and data/).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function check(file, pack) {
	if (!existsSync(file)) return false;
	const buf = readFileSync(file);
	return buf.length === pack.size && createHash('sha256').update(buf).digest('hex') === pack.sha256;
}

function repoSlug(root) {
	const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const m = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? '');
	return m ? m[1] : null;
}

/**
 * Returns { ok, dir, message }. `dir` is where the server should look (KITPACK_DIR). When a pack
 * cannot be fetched, `ok` is false and `message` says why (the preview still runs without it).
 */
export async function ensureKitPack(root, dir, log) {
	mkdirSync(dir, { recursive: true });
	const index = JSON.parse(readFileSync(join(root, 'kitpacks', 'index.json'), 'utf8'));
	writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
	const missing = [];
	for (const pack of index.packs) {
		const dest = join(dir, pack.file);
		if (check(dest, pack)) {
			log(`kit pack ${pack.file}: already fetched`);
			continue;
		}
		const local = join(root, 'kitpacks', pack.file);
		const tag = `kitpack-${pack.slug}-${pack.version}`;
		const tmp = `${dest}.part`;
		rmSync(tmp, { force: true });
		let why = '';
		if (check(local, pack)) {
			writeFileSync(tmp, readFileSync(local));
		} else {
			const repo = repoSlug(root);
			const gh = spawnSync('gh', ['--version'], { stdio: 'ignore' });
			if (gh.error || gh.status !== 0) why = 'the GitHub CLI (gh) is not installed';
			else if (!repo) why = 'the repository is not named in package.json';
			else {
				log(
					`kit pack ${pack.file}: downloading release ${tag} (about ${Math.round(pack.size / 1e6)} MB)`
				);
				const r = spawnSync(
					'gh',
					[
						'release',
						'download',
						tag,
						'--repo',
						repo,
						'--pattern',
						pack.file,
						'--output',
						tmp,
						'--clobber'
					],
					{ encoding: 'utf8' }
				);
				if (r.status !== 0)
					why = `gh release download failed: ${(r.stderr || '').trim().split('\n').pop()}`;
			}
		}
		if (!why && !check(tmp, pack))
			why = 'the downloaded file does not match the sha256 in kitpacks/index.json';
		if (why) {
			rmSync(tmp, { force: true });
			missing.push(`${pack.file}: ${why}`);
			continue;
		}
		renameSync(tmp, dest);
		log(`kit pack ${pack.file}: ok (sha256 verified)`);
	}
	return missing.length
		? { ok: false, dir, message: missing.join('; '), packs: index.packs }
		: { ok: true, dir, message: '', packs: index.packs };
}
