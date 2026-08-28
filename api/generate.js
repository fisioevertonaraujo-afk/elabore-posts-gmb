export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido' });
  }

  const { client, imageUrls } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'Chave GEMINI_API_KEY não configurada na Vercel.' });
  }

  try {
    const postsPromises = imageUrls.map(async (url) => {
      let directUrl = url;
      if (url.includes('drive.google.com')) {
        const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          directUrl = `https://lh3.googleusercontent.com/u/0/d/${match[1]}=s1000`;
        }
      }

      let base64Image = null;
      let mimeType = 'image/jpeg';
      try {
        const imgRes = await fetch(directUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        base64Image = Buffer.from(arrayBuffer).toString('base64');
        mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
      } catch (e) {
        // Prossegue caso a imagem falhe o fetch direto
      }

      const prompt = `
Você é o especialista sênior em SEO Local e Google Meu Negócio da agência Elabore.
Gere uma postagem de alta conversão para o GMB com base nos dados do cliente e na foto fornecida.

DADOS DO CLIENTE:
- Nome: ${client.nome}
- Segmento/Categoria: ${client.segmento} / ${client.categoria}
- Localização: Bairro ${client.bairro}, Cidade ${client.cidade}
- Serviços principais: ${client.servicos}
- Palavras-chave obrigatórias: ${client.keywords.join(', ')}
- Tom de Voz: ${client.tom}
- Restrições específicas: ${client.restricoes || 'Nenhuma'}
- Observações adicionais: ${client.obs || 'Nenhuma'}

DIRETRIZES RÍGIDAS DE GMB:
1. NUNCA inclua preços, valores monetários (R$), telefones, WhatsApp ou links externos no texto.
2. Não utilize travessão (-) como conector estilístico.
3. Seja conciso (100 a 180 palavras), com linguagem natural e persuasiva.
4. Conecte o texto ao que você está vendo na imagem.
5. Insira a localização (${client.bairro}, ${client.cidade}) de forma orgânica para indexação local.
6. Termine com CTA alinhado ao botão oficial (ex: clique em Saiba Mais ou Agende).

AUDITORIA VISUAL:
Analise a imagem para risco de rejeição no Google (ex: placas de carros visíveis, preços/etiquetas legíveis, marcas registradas).

FORMATO DA RESPOSTA (RESPONDA EXATAMENTE NESSE JSON):
{
  "statusSeguranca": "Aprovada" ou "Atenção: Risco Detectado",
  "alertaDetalhado": "Descreva o risco se houver (ex: Placa de carro visível) ou deixe vazio",
  "textoPost": "Texto da postagem pronto para o GMB"
}
`;

      const contents = [{
        role: "user",
        parts: [
          ...(base64Image ? [{ inlineData: { mimeType, data: base64Image } }] : []),
          { text: prompt }
        ]
      }];

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.4
          }
        })
      });

      const data = await geminiRes.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return JSON.parse(rawText);
    });

    const posts = await Promise.all(postsPromises);
    return res.status(200).json({ success: true, posts });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
