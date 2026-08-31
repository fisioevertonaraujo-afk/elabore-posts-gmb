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
Você é o especialista sênior em SEO Local, AEO (Answer Engine Optimization) e Google Meu Negócio da agência Elabore.

DADOS DA ENTIDADE / CLIENTE:
- Nome: ${client.nome}
- Segmento/Categoria: ${client.segmento} / ${client.categoria}
- Localização: Bairro ${client.bairro}, Cidade ${client.cidade}
- Serviços principais: ${client.servicos}
- Palavras-chave semânticas: ${client.keywords ? client.keywords.join(', ') : ''}
- Tom de Voz: ${client.tom || 'Profissional, direto e autoridade'}
- Restrições específicas: ${client.restricoes || 'Nenhuma'}
- Observações adicionais: ${client.obs || 'Nenhuma'}

DIRETRIZES DE AEO E REDAÇÃO (GOOGLE MEU NEGÓCIO):
1. REGRA DA RESPOSTA DIRETA (BLUF - Bottom Line Up Front):
   - A PRIMEIRA FRASE deve responder sem rodeios o que é o serviço/tema mostrado na foto, para quem serve e qual dor/necessidade resolve na prática. Proibido iniciar com saudações genéricas ("Olá", "Você sabia?", "No dia a dia...").
2. ENRIQUECIMENTO SEMÂNTICO DE ENTIDADES:
   - Cite com naturalidade o nome do serviço, o público/sintoma tratado e a localização exata (${client.bairro}, ${client.cidade}) para permitir que IAs de busca associem o negócio a buscas locais imediatas.
3. ESTRUTURA ESCANEÁVEL DO POST:
   - Gancho direto (dor/necessidade real relacionada à imagem)
   - Resolução prática e diferenciais em 2 a 3 linhas objetivas e espaçadas
   - Chamada para Ação (CTA) clara alinhada ao botão oficial (${client.cta || 'Saiba mais'}).
4. CONFORMIDADE RÍGIDA COM GMB:
   - NUNCA inclua preços, valores em dinheiro (R$), números de telefone, WhatsApp ou links externos no texto.
   - NUNCA use travessão (-) como conector estilístico.
   - Evite excesso de emojis; use apenas 1 ou 2 se estritamente necessários para escaneabilidade.
   - Tamanho ideal: 100 a 160 palavras.

SEO DE NOMEAÇÃO DA FOTO:
Crie um nome de arquivo em minúsculas, sem acentos, com palavras separadas por hífen e extensão .jpg.
Estrutura: [servico-ou-termo-da-foto]-[bairro]-[cidade]-[nome-cliente].jpg

AUDITORIA VISUAL:
Analise a imagem para risco de rejeição no Google (placas de veículos legíveis, preços visíveis em etiquetas/cardápios, telefones ou links sobrepostos, imagens genéricas). Se houver risco, marque "Atenção: Risco Detectado" e descreva em "alertaDetalhado". Caso contrário, marque "Aprovada" e deixe "alertaDetalhado" vazio.

Retorne APENAS um JSON válido no formato:
{
  "nomeArquivoSugerido": "servico-bairro-cidade-cliente.jpg",
  "statusSeguranca": "Aprovada" ou "Atenção: Risco Detectado",
  "alertaDetalhado": "Explicação da diretriz violada e como corrigir ou vazio",
  "textoPost": "Texto da postagem pronto para o GMB estruturado com BLUF e AEO"
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
