export default async function handler(req, res) {
  const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ1kreI30JF-ohHfyCBdzaCN66UW3D1X6b6R8Sc1Ptnt7oE9AS65hC5CQUMjntjW9_EPt3ZLuyWWsUL/pub?gid=1612539340&single=true&output=csv";

  try {
    const response = await fetch(SHEET_CSV_URL);
    const csvText = await response.text();

    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentCell += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if ((char === '\r' || char === '\n') && !insideQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        currentRow.push(currentCell.trim());
        if (currentRow.length > 1) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    if (currentCell || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.length > 1) rows.push(currentRow);
    }

    if (rows.length < 2) {
      return res.status(200).json({ success: true, clients: [] });
    }

    const clients = rows.slice(1).map(cols => {
      const getVal = (idx) => cols[idx] || '';
      return {
        status: getVal(0),
        id: getVal(1),
        nome: getVal(2),
        segmento: getVal(3),
        pastaDrive: getVal(5),
        cidade: getVal(6),
        bairro: getVal(7),
        servicos: getVal(8),
        cta: getVal(9),
        destinoCta: getVal(10),
        restricoes: getVal(11),
        categoria: getVal(12),
        keywords: [getVal(13), getVal(14), getVal(15), getVal(16), getVal(17)].filter(Boolean),
        tom: getVal(18) || 'Profissional e direto',
        frequencia: getVal(19),
        obs: getVal(20)
      };
    }).filter(c => c.nome && c.status.toLowerCase() === 'ativo');

    return res.status(200).json({ success: true, clients });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
