// Keep authentication, refresh and inference in the pinned MIT community source.
export function adaptWorkBuddySource(source) {
  const marker = 'async function liveModels(site, a) {';
  if (source.split(marker).length !== 2) throw new Error('WorkBuddy catalog seam changed');
  return source.replace(marker, marker + '\n  if (site.catalog) return site.catalog();') +
    '\nexport {makePlugin, current, meter, reissued};\n';
}
