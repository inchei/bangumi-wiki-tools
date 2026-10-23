function isStrictInt(str) {
  return /^-?\d+$/.test(str);
}

export function sortAppearEps(eps) {
  return eps.sort((a, b) => {
    const isANum = isStrictInt(a);
    const isBNum = isStrictInt(b);
    if (isANum && isBNum) return Number(a) - Number(b);
    if (isANum) return -1;
    if (isBNum) return 1;
    return a.localeCompare(b);
  });
}

export function parseAppearEps(input) {
  if (!input) return [];

  const rawSegments = input
    .split(',')
    .map((seg) => seg.trim())
    .filter((seg) => seg);

  const resultSet = new Set();

  rawSegments.forEach((seg) => {
    if (seg.includes('-')) {
      const [s, e] = seg.split('-').map((p) => p.trim());
      if (isStrictInt(s) && isStrictInt(e)) {
        const min = Math.min(Number(s), Number(e));
        const max = Math.max(Number(s), Number(e));
        for (let i = min; i <= max; i++) {
          resultSet.add(i.toString());
        }
      } else {
        resultSet.add(seg);
      }
    } else {
      resultSet.add(seg);
    }
  });

  return sortAppearEps(Array.from(resultSet));
}

export function genAppearEps(epArr) {
  if (!epArr || !epArr.length) return '';
  epArr = sortAppearEps([...new Set(epArr)]);

  const integers = epArr.filter(isStrictInt).map(Number);
  const others = epArr.filter((e) => !isStrictInt(e));

  const rangeParts = [];

  if (integers.length > 0) {
    let start = integers[0];
    let prev = integers[0];

    for (let i = 1; i <= integers.length; i++) {
      const curr = integers[i];
      if (i < integers.length && curr === prev + 1) {
        prev = curr;
      } else {
        rangeParts.push(start === prev ? `${start}` : `${start}-${prev}`);
        if (i < integers.length) {
          start = curr;
          prev = curr;
        }
      }
    }
  }

  return [...rangeParts, ...others].join(',');
}
