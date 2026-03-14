module.exports = async function handler(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'Пустой поисковый запрос' });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Не задан GOOGLE_MAPS_API_KEY' });
    }

    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey
      },
      body: JSON.stringify({
        input: q,
        languageCode: 'uk',
        includedPrimaryTypes: ['locality', 'administrative_area_level_3'],
        regionCode: 'UA'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'Ошибка Google Places Autocomplete',
        details: data
      });
    }

    const suggestions = (data.suggestions || [])
      .map(x => x.placePrediction)
      .filter(Boolean)
      .map(x => ({
        placeId: x.placeId,
        text: x.text?.text || x.structuredFormat?.mainText?.text || 'Без названия'
      }));

    return res.status(200).json({ suggestions });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
};
