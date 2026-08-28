export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido' });
  }

  const { client, images } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'Chave GEMINI_API_KEY não configurada na Vercel.' });
  }

  try {
    const postsPromises = images.map(async (imgObj) => {
      let base64Image = null;
      let mimeType = 'image/jpeg';

      if (imgObj.type === 'base64') {
        base64Image = imgObj.data;
        mimeType = imgObj.mimeType || 'image/jpeg';
      } else if (imgObj.type === 'url' && imgObj.url) {
        let directUrl = imgObj.url;
        if (directUrl.includes('drive.google.com')) {
          const match = directUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || directUrl.match(/id=([a-zA-Z0-9_-]+)/);
          if (match && match[1]) {
            directUrl = `https://lh3.googleusercontent.com/u/0/d/${match[1]}=s1000`;
          }
        }
        try {
          const imgRes = await fetch(directUrl);
          const arrayBuffer = await imgRes.arrayBuffer();
          base64Image = Buffer.from(arrayBuffer).toString('base64');
          mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
        } catch (e) {
          console.error("Erro ao baixar imagem via URL:", e);
        }
      }

      const prompt = `
Você é o especialista sênior em SEO Local e Google Meu Negócio da agência Elabore.
Gere uma postagem de alta conversão para o GMB com base nos dados do cliente e na imagem fornecida.

DADOS DO CLIENTE:
- Nome: ${client.nome}
- Segmento/Categoria: ${client.segmento} / ${client.categoria}
- Localização: Bairro ${client.bairro}, Cidade ${client.cidade}
- Serviços principais: ${client.servicos}
- Palavras-chave obrigatórias: ${client.keywords ? client.keywords.join(', ') : ''}
- Tom de Voz: ${client.tom || 'Profissional e direto'}
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

Retorne APENAS um objeto JSON válido (sem tags markdown de código em volta):
{
  "statusSeguranca": "Aprovada" ou "Atenção: Risco Detectado",
  "alertaDetalhado": "Descreva o risco se houver ou deixe vazio",
  "textoPost": "Texto da postagem pronto para o GMB"
}
`;

      const parts = [];
      if (base64Image) {
        parts.push({
          inlineData: {
            mimeType: mimeType.split(';')[0],
            data: base64Image
          }
        });
      }
      parts.push({ text: prompt });

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.3
          }
        })
      });

      const data = await geminiRes.json();

      if (data.error) {
        throw new Error(data.error.message || 'Erro na API do Gemini');
      }

      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error('Nenhum texto retornado pelo modelo de IA.');
      }

      const cleanedText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      return JSON.parse(cleanedText);
    });

    const posts = await Promise.all(postsPromises);
    return res.status(200).json({ success: true, posts });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
