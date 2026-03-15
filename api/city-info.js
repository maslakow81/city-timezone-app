export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { placeId, date, time } = req.body || {};

    if (!placeId || !date || !time) {
      return res.status(400).json({ error: 'placeId, date, time required' });
    }

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;

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

    if (!placeResp.ok) {
      return res.status(placeResp.status).json({ error: 'Google Places error', details: place });
    }

    const lat = place.location?.latitude;
    const lng = place.location?.longitude;

    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'Coordinates not found' });
    }

    const timestamp = Math.floor(
      new Date(`${date}T12:00:00Z`).getTime() / 1000
    );

    const tzResp = await fetch(
      `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${timestamp}&key=${encodeURIComponent(googleApiKey)}`
    );

    const tzData = await tzResp.json();

    if (!tzResp.ok || tzData.status !== 'OK') {
      return res.status(400).json({ error: 'Google Time Zone error', details: tzData });
    }

    const totalOffsetSeconds =
      (tzData.rawOffset || 0) + (tzData.dstOffset || 0);

    function buildDatetime(date, time, totalOffsetSeconds) {
      const [year, month, day] = date.split('-').map(Number);
      const [hours, minutes] = time.split(':').map(Number);

      const formTotalMinutes = hours * 60 + minutes;
      const offsetMinutes = Math.trunc(totalOffsetSeconds / 60);
      const shiftedTotalMinutes = formTotalMinutes - offsetMinutes;

      const baseDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
      const dayShift = Math.floor(shiftedTotalMinutes / 1440);
      const normalizedMinutes = ((shiftedTotalMinutes % 1440) + 1440) % 1440;

      baseDate.setUTCDate(baseDate.getUTCDate() + dayShift);

      const outYear = baseDate.getUTCFullYear();
      const outMonth = String(baseDate.getUTCMonth() + 1).padStart(2, '0');
      const outDay = String(baseDate.getUTCDate()).padStart(2, '0');

      const outHours = String(Math.floor(normalizedMinutes / 60)).padStart(2, '0');
      const outMinutes = String(normalizedMinutes % 60).padStart(2, '0');

      const absOffsetMinutes = Math.abs(offsetMinutes);
      const tzHours = String(Math.floor(absOffsetMinutes / 60)).padStart(2, '0');
      const tzMinutes = String(absOffsetMinutes % 60).padStart(2, '0');

      return `${outYear}-${outMonth}-${outDay}T${outHours}:${outMinutes}:00%2B${tzHours}:${tzMinutes}`;
    }

    async function getProkeralaToken() {
      const resp = await fetch('https://api.prokerala.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.PROKERALA_CLIENT_ID,
          client_secret: process.env.PROKERALA_CLIENT_SECRET
        })
      });

      const data = await resp.json();

      if (!resp.ok || !data.access_token) {
        throw new Error(`Prokerala token error: ${JSON.stringify(data)}`);
      }

      return data.access_token;
    }

    const datetime = buildDatetime(date, time, totalOffsetSeconds);
    const coordinates = `${lng},${lat}`;
    const token = await getProkeralaToken();

    const prokeralaUrl =
      `https://api.prokerala.com/v2/astrology/planet-position` +
      `?ayanamsa=1` +
      `&coordinates=${encodeURIComponent(coordinates)}` +
      `&datetime=${datetime}` +
      `&la=en`;

    const astrologyResp = await fetch(prokeralaUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const astrologyData = await astrologyResp.json();

    const chartUrl =
      `https://api.prokerala.com/v2/astrology/chart` +
      `?ayanamsa=1` +
      `&coordinates=${encodeURIComponent(coordinates)}` +
      `&datetime=${datetime}` +
      `&chart_type=rasi` +
      `&chart_style=north-indian` +
      `&format=svg` +
      `&la=en` +
      `&upagraha_position=middle`;

    const chartResp = await fetch(chartUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const chartSvg = await chartResp.text();

    const response = {
      city: place.displayName?.text || null,
      address: place.formattedAddress || null,
      coordinates: {
        lat,
        lng
      },
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
      prokeralaStatus: astrologyResp.status,
      chartRequest: {
        url: chartUrl
      },
      chartStatus: chartResp.status,
      chartSvg: chartResp.ok ? chartSvg : null
    };

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Internal error'
    });
  }
}
