function buildDatetime(date, time, totalOffsetSeconds) {
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);

    // Локальное время формы переводим в минуты
    const formTotalMinutes = hours * 60 + minutes;

    // Смещение в минутах
    const offsetMinutes = Math.trunc(totalOffsetSeconds / 60);

    // По твоей логике:
    // если offset положительный -> вычитаем
    // если offset отрицательный -> прибавляем
    // это одинаково как: formTotalMinutes - offsetMinutes
    const shiftedTotalMinutes = formTotalMinutes - offsetMinutes;

    // Базовая дата в UTC, чтобы безопасно сдвигать сутки
    const baseDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

    // Сколько суток ушло вперёд/назад
    const dayShift = Math.floor(shiftedTotalMinutes / 1440);

    // Минуты внутри суток 0..1439
    const normalizedMinutes = ((shiftedTotalMinutes % 1440) + 1440) % 1440;

    // Сдвигаем дату на нужное число суток
    baseDate.setUTCDate(baseDate.getUTCDate() + dayShift);

    const outYear = baseDate.getUTCFullYear();
    const outMonth = String(baseDate.getUTCMonth() + 1).padStart(2, '0');
    const outDay = String(baseDate.getUTCDate()).padStart(2, '0');

    const outHours = String(Math.floor(normalizedMinutes / 60)).padStart(2, '0');
    const outMinutes = String(normalizedMinutes % 60).padStart(2, '0');

    // Формируем timezone suffix
    const sign = totalOffsetSeconds >= 0 ? '%2B' : '-';
    const absOffsetMinutes = Math.abs(offsetMinutes);
    const tzHours = String(Math.floor(absOffsetMinutes / 60)).padStart(2, '0');
    const tzMinutes = String(absOffsetMinutes % 60).padStart(2, '0');

    return `${outYear}-${outMonth}-${outDay}T${outHours}:${outMinutes}:00${sign}${tzHours}:${tzMinutes}`;
}

async function getProkeralaToken() {
  const clientId = process.env.PROKERALA_CLIENT_ID;
  const clientSecret = process.env.PROKERALA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Не заданы PROKERALA_CLIENT_ID или PROKERALA_CLIENT_SECRET');
  }

  const tokenResp = await fetch('https://api.prokerala.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  const tokenData = await tokenResp.json();

  if (!tokenResp.ok || !tokenData.access_token) {
    throw new Error(`Ошибка получения токена Prokerala: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { placeId, date, time } = req.body || {};

    if (!placeId || !date || !time) {
      return res.status(400).json({ error: 'Нужны placeId, date и time' });
    }

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleApiKey) {
      return res.status(500).json({ error: 'Не задан GOOGLE_MAPS_API_KEY' });
    }

    const placeResp = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          'X-Goog-Api-Key': googleApiKey,
          'X-Goog-FieldMask': 'displayName,formattedAddress,location'
        }
      }
    );

    const place = await placeResp.json();
    if (!placeResp.ok || !place.location) {
      throw new Error(`Ошибка Places Details: ${JSON.stringify(place)}`);
    }

    const lat = place.location.latitude;
    const lng = place.location.longitude;

    const timestamp = Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 1000);

    const tzResp = await fetch(
      `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${encodeURIComponent(googleApiKey)}`
    );
    const tzData = await tzResp.json();

    if (!tzResp.ok || tzData.status !== 'OK') {
      throw new Error(`Ошибка Time Zone API: ${JSON.stringify(tzData)}`);
    }

    const totalOffsetSeconds = (tzData.rawOffset || 0) + (tzData.dstOffset || 0);
    const datetime = buildDatetime(date, time, totalOffsetSeconds);
    const coordinates = `${lng},${lat}`;

    const accessToken = await getProkeralaToken();

    const prokeralaUrl =
      `https://api.prokerala.com/v2/astrology/planet-position` +
      `?ayanamsa=1` +
      `&coordinates=${encodeURIComponent(coordinates)}` +
      `&datetime=${datetime}` +
      `&la=en`;

    const astrologyResp = await fetch(prokeralaUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const astrologyData = await astrologyResp.json();

    const response = {
      city: place.displayName?.text || null,
      address: place.formattedAddress || null,
      coordinates: { lat, lng },
      date,
      time,
      timezone: {
        id: tzData.timeZoneId || null,
        name: tzData.timeZoneName || null,
        rawOffset: tzData.rawOffset ?? null,
        dstOffset: tzData.dstOffset ?? null,
        totalOffsetSeconds
      },
      prokeralaRequest: {
        coordinates,
        datetime,
        url: prokeralaUrl
      },
      prokeralaResponse: astrologyData,
      prokeralaStatus: astrologyResp.status
    };

    return res.status(astrologyResp.ok ? 200 : 502).json(response);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
