# Fliggy hotel API integration

The Fliggy page linked in the project conversation is the Taobao Open Platform
TOP API catalog. The relevant APIs are:

- `taobao.xhotel.distribution.feed.hotel.query` for the static hotel feed;
- `taobao.xhotel.distribution.foundation.hotel.query` for static hotel details by
  Fliggy `shid`;
- `taobao.xhotel.distribution.ari.availability` for date-specific rates and
  availability.
- `alitrip.flight.service.search` for flight quotation/search.

The production HTTPS endpoint is `https://eco.taobao.com/router/rest`. Requests
use TOP `app_key`, `timestamp`, `v=2.0`, `format=json`, `sign_method=hmac`, and
an HMAC-MD5 signature. The server-side client is
`src/services/booking/fliggy-top.ts`.

## Configuration

Copy these fields to `.env.local` after Fliggy approves the application. Never
put them in `NEXT_PUBLIC_*` variables or send them from the browser:

```env
FLIGGY_APP_KEY=your_app_key
FLIGGY_APP_SECRET=your_app_secret
FLIGGY_SESSION=optional_session
FLIGGY_DISTRIBUTOR=optional_distributor_code
FLIGGY_API_URL=https://eco.taobao.com/router/rest
```

The catalog does not provide a city keyword search that can replace AMap POI
search. The feed API is paginated and the availability API requires a Fliggy
hotel ID, dates, and occupancy. Therefore Voyage must first map its AMap hotel
candidate to a Fliggy hotel ID before asking for live price or inventory.

The current adapter only establishes the signed server boundary. It does not
claim live availability until an approved Fliggy app, distributor code, and
hotel ID mapping are configured.

## Internal server routes

After credentials are configured, the web app can call these server-only
routes. They return `503 FLIGGY_NOT_CONFIGURED` until the credentials exist and
never expose AppSecret:

- `GET /api/booking/fliggy/feed?page=1&size=50` fetches a static feed page;
- `GET /api/booking/fliggy/hotel-info?shids=123,456` fetches static hotel data;
- `GET /api/booking/fliggy/availability?hotelId=...&checkIn=2026-10-01&checkOut=2026-10-02&adults=2`
  fetches date-specific rates and inventory.
- `GET /api/booking/fliggy/flights/search?departureCityCode=CKG&arrivalCityCode=KWE&departureDate=2026-10-01&externalAgentName=...`
  requests a flight quotation. The city values are IATA three-letter codes.

The feed endpoint is not a city keyword search. A production mapping job still
needs to connect AMap hotel candidates to Fliggy `hotel_id`/`shid` values before
the availability route can be shown on a hotel card.

The current Fliggy train category does not list a public train timetable or
seat-availability search API. It lists agent order, ticketing, refund, and
status operations. Voyage therefore cannot claim train availability from this
AppKey until Fliggy grants a separate train search/agent product.
