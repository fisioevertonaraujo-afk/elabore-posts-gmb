export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Método não permitido' });
  }

  const { client, images, videoContext } = req.body;
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

  const clientHeader = `
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
   - A PRIMEIRA FRASE deve responder diretamente o que é o serviço/assunto, para quem serve e qual dor ou condição resolve. Sem introduções genéricas ("Olá", "Você sabia?", etc.).
2. ENRIQUECIMENTO SEMÂNTICO DE ENTIDADES:
   - Cite o nome do serviço, o público ou problema tratado e a localização exata (${client.bairro}, ${client.cidade}) de forma natural.
3. ESTRUTURA ESCANEÁVEL:
   - Gancho direto (dor/necessidade real)
   - Resolução prática e diferenciais em 2 a 3 linhas espaçadas
   - Chamada para Ação (CTA) clara alinhada ao botão oficial (${client.cta || 'Saiba mais'}).
4. CONFORMIDADE RÍGIDA COM GMB:
   - Proibido preços, valores monetários (R$), números de telefone, WhatsApp ou links no texto.
   - Proibido travessão (-) como conector estilístico.
   - Limite de 100 a 160 palavras.
`;

  try {
    const postsPromises = (images || []).map(async (imgObj, index) => {
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
Você é o especialista sênior em SEO Local, AEO e Google Meu Negócio da agência Elabore.
${clientHeader}

SEO DE NOMEAÇÃO DA FOTO:
Gere uma sugestão de nome de arquivo em minúsculas, sem acentos, com hífens e extensão .jpg.
Estrutura: [servico-ou-termo-da-foto]-[bairro]-[cidade]-[nome-cliente].jpg

AUDITORIA VISUAL:
Analise a imagem para risco de rejeição no Google (placas de veículos legíveis, preços em etiquetas, telefones ou links sobrepostos, imagens genéricas). Se houver risco, marque "Atenção: Risco Detectado" e descreva em "alertaDetalhado". Caso contrário, "Aprovada" e deixe vazio.

Retorne APENAS um JSON válido:
{
  "tipo": "foto",
  "nomeArquivoSugerido": "servico-bairro-cidade-cliente.jpg",
  "statusSeguranca": "Aprovada" ou "Atenção: Risco Detectado",
  "alertaDetalhado": "Explicação ou vazio",
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
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
        })
      });

      let data = await response.json();
      if (data.error) {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
          })
        });
        data = await response.json();
      }

      if (data.error) throw new Error(data.error.message || 'Erro na API do Gemini');
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(rawText.replace(/```json/gi, '').replace(/```/g, '').trim());

      if (!parsed.nomeArquivoSugerido) {
        const kw = client.keywords?.[index % client.keywords.length] || client.segmento || 'servico';
        parsed.nomeArquivoSugerido = `${slugify(kw)}-${slugify(client.bairro)}-${slugify(client.cidade)}-${slugify(client.nome)}.jpg`;
      } else {
        parsed.nomeArquivoSugerido = slugify(parsed.nomeArquivoSugerido.replace(/\.jpg$/i, '')) + '.jpg';
      }
      parsed.tipo = "foto";
      return parsed;
    });

    const posts = await Promise.all(postsPromises);

    if (videoContext && videoContext.trim()) {
      const videoPrompt = `
Você é o especialista sênior em SEO Local, AEO e Google Meu Negócio da agência Elabore.
${clientHeader}

CONTEXTO DO VÍDEO INFORMADO PELA EQUIPE:
"${videoContext.trim()}"

TAREFA:
Crie a postagem do Google Meu Negócio para acompanhar esse vídeo semanal.
1. Aplique a regra BLUF na primeira linha com clareza total.
2. Destaque o diferencial demonstrado no vídeo em 2 a 3 pontos diretos.
3. Conecte ao bairro e cidade do cliente (${client.bairro}, ${client.cidade}).
4. Gere uma sugestão de nome de arquivo para o vídeo em .mp4 estruturado para SEO Local.

Retorne APENAS um JSON válido:
{
  "tipo": "video",
  "nomeArquivoSugerido": "tema-do-video-bairro-cidade-cliente.mp4",
  "statusSeguranca": "Aprovada",
  "alertaDetalhado": "",
  "textoPost": "Texto da postagem do vídeo para o GMB estruturado com BLUF e AEO"
}
`;

      let vResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: videoPrompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
        })
      });

      let vData = await vResponse.json();
      if (!vData.error) {
        const vRawText = vData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (vRawText) {
          const vParsed = JSON.parse(vRawText.replace(/```json/gi, '').replace(/```/g, '').trim());
          vParsed.tipo = "video";
          if (!vParsed.nomeArquivoSugerido) {
            vParsed.nomeArquivoSugerido = `${slugify(client.keywords?.[0] || 'video')}-${slugify(client.bairro)}-${slugify(client.cidade)}-${slugify(client.nome)}.mp4`;
          } else {
            vParsed.nomeArquivoSugerido = slugify(vParsed.nomeArquivoSugerido.replace(/\.mp4$/i, '')) + '.mp4';
          }
          posts.push(vParsed);
        }
      }
    }

    return res.status(200).json({ success: true, posts });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
