export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido' });
  }

  const { client, images } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'Chave GEMINI_API_KEY não configurada na Vercel.' });
  }

  const slugify = (text) => {
    return (text || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  try {
    const postsPromises = images.map(async (imgObj, index) => {
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
Você é o especialista sênior em SEO Local e auditor de diretrizes do Google Meu Negócio da agência Elabore.

DADOS DO CLIENTE:
- Nome: ${client.nome}
- Segmento/Categoria: ${client.segmento} / ${client.categoria}
- Localização: Bairro ${client.bairro}, Cidade ${client.cidade}
- Serviços principais: ${client.servicos}
- Palavras-chave obrigatórias: ${client.keywords ? client.keywords.join(', ') : ''}
- Tom de Voz: ${client.tom || 'Profissional e direto'}
- Restrições específicas: ${client.restricoes || 'Nenhuma'}
- Observações adicionais: ${client.obs || 'Nenhuma'}

DIRETRIZES DE TEXTO GMB:
1. NUNCA inclua preços, valores monetários (R$), telefones, WhatsApp ou links externos no texto.
2. Não utilize travessão (-) como conector estilístico no texto do post.
3. Seja conciso (100 a 180 palavras), com linguagem natural e persuasiva.
4. Conecte o texto ao que você está vendo na imagem.
5. Insira a localização (${client.bairro}, ${client.cidade}) de forma orgânica para indexação local.
6. Termine com CTA alinhado ao botão oficial (ex: clique em Saiba Mais ou Agende).

SEO DE NOMEAÇÃO DA IMAGEM:
Crie um nome de arquivo em minúsculas, sem acentos, com palavras separadas por hífen e extensão .jpg.
Estrutura: [termo-do-servico-na-foto]-[bairro]-[cidade]-[nome-do-cliente].jpg

AUDITORIA VISUAL RIGOROSA (DIRETRIZES DO GOOGLE MEU NEGÓCIO):
Analise a imagem minuciosamente quanto a possíveis infrações que causam rejeição ou suspensão no Google:
1. Placas de veículos expostas e legíveis.
2. Valores monetários, preços (R$) ou promoções explícitas visíveis em faixas/etiquetas.
3. Telefones, números de WhatsApp, URLs ou links gravados diretamente sobre a foto.
4. Rostos de terceiros não autorizados ou clientes em primeiro plano sem contexto.
5. Imagem com qualidade excessivamente baixa, borrada, muito escura ou com cara de banco de imagens genérico.
6. Sobreposição excessiva de texto ou elementos promocionais poluindo a imagem.

Se encontrar QUALQUER um desses pontos, marque "statusSeguranca" como "Atenção: Risco Detectado" e no "alertaDetalhado" explique exatamente o que foi visto e como ajustar (ex: "Placa de veículo visível ao fundo da foto. Recomendado borrar a placa antes de publicar no GMB.").
Se a imagem estiver 100% segura, marque "statusSeguranca" como "Aprovada" e deixe "alertaDetalhado" vazio.

Retorne APENAS um objeto JSON válido:
{
  "nomeArquivoSugerido": "servico-bairro-cidade-cliente.jpg",
  "statusSeguranca": "Aprovada" ou "Atenção: Risco Detectado",
  "alertaDetalhado": "Explicação clara e específica da diretriz violada e como corrigir",
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

      let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        })
      });

      let data = await response.json();

      if (data.error) {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2
            }
          })
        });
        data = await response.json();
      }

      if (data.error) {
        throw new Error(data.error.message || 'Erro na API do Gemini');
      }

      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error('Nenhum texto retornado pelo modelo.');
      }

      const cleanedText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanedText);

      if (!parsed.nomeArquivoSugerido) {
        const kw = client.keywords?.[index % client.keywords.length] || client.segmento || 'servico';
        parsed.nomeArquivoSugerido = `${slugify(kw)}-${slugify(client.bairro)}-${slugify(client.cidade)}-${slugify(client.nome)}.jpg`;
      } else {
        parsed.nomeArquivoSugerido = slugify(parsed.nomeArquivoSugerido.replace(/\.jpg$/i, '')) + '.jpg';
      }

      return parsed;
    });

    const posts = await Promise.all(postsPromises);
    return res.status(200).json({ success: true, posts });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
