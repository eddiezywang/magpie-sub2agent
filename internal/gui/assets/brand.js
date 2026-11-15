/* Sub2Agent brand wordmark.
   Bitrimus by GGBot — https://fontesk.com/bitrimus-font/ — Free for commercial use.
   Only the glyphs for "Sub2Agent" (plus caps/digits/space) are kept, gzipped
   and embedded here so no binary asset has to ship. Decompressed with the
   browser's DecompressionStream, then registered as a FontFace. */
(() => {
  if (!('DecompressionStream' in window) || !('FontFace' in window)) return;
  const b64 = [
    'H4sIAAAAAAAACr1XXUxbZRh+3vPTH/4xrRqkWImLxCiOubE5GUInLKTJmNAhyWKgjANtoC3pDxJnYuPlzib+MJ1zbm56pcZ4M73AC+JfNNwZTLwxDm+MicmM2dJCNUdPe3b42nPaQqOefuecJ9/3vf/v+72ngz7fIOxIgkfD4f5+NwIrM4DYBlQfGhx+ZE9gbOIFgABg/GTIPyc8I44DQjOA3wKSf7L9+9AmgIsAOgMByS88RCcArAG4PxCKL+z6BK1AQwBAIORfmEPTMZVXGoAl7A9Jm67nrwE0DnDLc5FY',
    'HLy6LNoAuLNiCZj68A9lrL7rFnhBXcQv9zrXt95KkpK0AoAHh9xFAPe+kgSy86BkzgDmagKOZZ/gKUY3IQLcaW4ZwJncm35CB3EFVHlcRkdHR9EDNxK6rOTtPXScVuCGO7uxlS7plIQBDRNqdY4crHhAwzzuwg8aFuBEl4ZFVONTDVvgwCkNWxmeNgbbGVzF4GoG1zC4lsF1DG5g9GzM6smDBHtW6xkNE5pQq2EOdWjXMI923NCwgAfxlIZF3InPNWxBGxY1bGV42hhsZ3AVg6sZXMPgWgbXMbiB0bNR1dMT',
    'jEeDoUTME/WHJ+FBEHFEEUQICcTgQRR+hDE5JE0nZv1RDEHCNBKYhR/RPFr37S1FecBdgrw8dR7tiBSNBSNh9+72DoxAQhQxBBFBGG7sRjs63AfNtXPj4PY1zGUpn419DQRcB7AXbghwZOV0YA8exV7sQyf24wAeQy886MMRHMUwfDiOiSy7MOJIKEq2ondMpfyurCvrynfK9bzfl8q3yjfKV8qK8pGyrFxTrihXlcvKBeWcctZQ69u7+NLLBIFARE7TuBGRJ30P0s1c2sWnWwQ549joTvtEF4Bb9S6A2hpl',
    'l3qm3tFSBfv8yC6lpb6lnsU1VriIau5r39e5/8DjXYe6n+jp9Rx+sq/fOzj09ImxienZOSbspuE1U204MRF/NtI7LYXjxz1H+o76YnP+k9JzUjQSCUvxQFSSpiKJ6FRwXooFF2LSvBSWgtOBeDgYllSrZTpDZ+klWqSX6RV6lV6jJTpHr9MbdJ7epAv0Fl2kt+kSXaZ36ApdpXfRxIHwMJbwKw3Qx1wzt8jd5Af484IonBJ+FgfFzyyixWaJW76w9lk/sN1tO227YZ+x/5iuSn0tOzPvyaK80S2m1Pdf3WLm',
    'xY1mp/znppgal0U5vSlmxmWxLu1IrclOryyyQ15Vx6qsjn8AO8ku6UP2qkPb5s2bzI1SYgqY6jSrctGlHTA10hdorY+ML+Vw6gaX55/bavRQgWNY9+hPVoE8MbrwssYUM0M3xufUPejNk5VxmNi0xW61TIDKCl4yeNG36tRJtpMDRhFb+7PO85YKlc7Ma2CwI4PqUmupJSb+eXyZFDDmFxtwfabCdDWthxLbKqwNU5ez1phViLyziikmteD4KDC3wtOk7EFVUIkFM0x5+tKOgvJkUms7Udx6lg1bai3lM+Sx',
    'MeuMBhkY+VQvLeV7yVRHU47syHHPOPRgG6ursFSMFWJqgEmGbyfAxRrTf5XJxY5EtgNUfBwXc1sFrdc0f3X7//2qKbDWtIEas3lHoSvomyow6S9lu/T/kSWmISzRUCvrpuqX5DxaKZn9L1787jGZW8nNY6XEHub+G2LUgYvQEAAA'
  ].join('');
  const bin = atob(b64);
  const gz = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  new Response(stream).arrayBuffer().then((buf) => {
    const face = new FontFace('BitrimusBrand', buf, { weight: '400', style: 'normal', display: 'swap' });
    return face.load().then((f) => document.fonts.add(f));
  }).catch(() => {});
})();
