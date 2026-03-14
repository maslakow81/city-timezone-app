module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { placeId, date } = req.body || {};
    if (!placeId || !date) {
      return res.status(400).json({ error: 'Нужны placeId и date' });
    }

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleApiKey) {
      return res.status(500).json({ error: 'Не задан GOOGLE_MAPS_API_KEY' });
    }

    const otherApiUrl = process.env.OTHER_API_URL || '';
    const otherApiKey = process.env.OTHER_API_KEY || '';

    const detailsResp = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          'X-Goog-Api-Key': googleApiKey,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,location'
        }
      }
    );

    const place = await detailsResp.json();

    if (!detailsResp.ok) {
      return res.status(detailsResp.status).json({
        error: place.error?.message || 'Ошибка Google Place Details',
        details: place
      });
    }

    const lat = place.location?.latitude;
    const lng = place.location?.longitude;

    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'Не удалось получить координаты' });
    }

    const timestamp = Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 1000);
    if (!Number.isFinite(timestamp)) {
      return res.status(400).json({ error: 'Некорректная дата' });
    }

    const tzResp = await fetch(
      `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${encodeURIComponent(googleApiKey)}`
    );
    const tzData = await tzResp.json();

    if (!tzResp.ok || (tzData.status && tzData.status !== 'OK')) {
      return res.status(400).json({
        error: tzData.errorMessage || tzData.status || 'Ошибка Google Time Zone API',
        details: tzData
      });
    }

    let otherApiRaw = null;
    let otherApiInterpreted = null;

    if (otherApiUrl) {
      const extResp = await fetch(otherApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(otherApiKey ? { Authorization: `Bearer ${otherApiKey}` } : {})
        },
        body: JSON.stringify({
          placeId,
          date,
          coordinates: { lat, lng },
          timeZoneId: tzData.timeZoneId || null
        })
      });

      otherApiRaw = await extResp.json().catch(() => null);
      otherApiInterpreted = interpretOtherApiResponse(otherApiRaw, extResp.ok);
    }

    return res.status(200).json({
      city: place.displayName?.text || place.formattedAddress || null,
      address: place.formattedAddress || null,
      coordinates: { lat, lng },
      date,
      timezone: {
        id: tzData.timeZoneId || null,
        name: tzData.timeZoneName || null,
        rawOffset: tzData.rawOffset ?? null,
        dstOffset: tzData.dstOffset ?? null,
        totalOffsetSeconds: (tzData.rawOffset || 0) + (tzData.dstOffset || 0)
      },
      otherApi: {
        configured: Boolean(otherApiUrl),
        raw: otherApiRaw,
        interpreted: otherApiInterpreted
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
};

function interpretOtherApiResponse(payload, isSuccess) {
  if (payload == null) {
    return {
      ok: isSuccess,
      summary: 'Другой API не вернул JSON или ответ пустой.'
    };
  }

  return {
    ok: isSuccess,
    summary: isSuccess ? 'Второй API успешно вызван.' : 'Второй API вернул ошибку.',
    keys: typeof payload === 'object' ? Object.keys(payload) : [],
    note: 'Замените эту функцию своей бизнес-логикой интерпретации ответа.'
  };
}
