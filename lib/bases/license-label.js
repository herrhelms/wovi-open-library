// Shared by the Europeana and Internet Archive adaptors.
export function licenseLabel(url) {
  if (typeof url !== 'string' || url === '') return 'See item page';

  if (url.includes('publicdomain/zero')) return 'CC0';
  if (url.includes('publicdomain/mark')) return 'Public domain';

  const cc = url.match(/\/licenses\/(by(?:-(?:sa|nd|nc|nc-sa|nc-nd))?)\/([0-9.]+)/i);
  if (cc) {
    return `CC ${cc[1].toUpperCase()} ${cc[2]}`;
  }

  const rights = url.match(/rightsstatements\.org\/vocab\/(NoC-[A-Za-z0-9-]+)/);
  if (rights) {
    return `No copyright (${rights[1]})`;
  }

  return 'See item page';
}
