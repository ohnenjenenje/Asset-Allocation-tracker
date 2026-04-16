import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // Default Tickertape Screener Query
    const defaultQuery = {
      filters: [
        {
          id: "marketCap",
          op: "gt",
          val: 0
        }
      ],
      offset: 0,
      limit: 20,
      sort: "marketCap",
      order: -1,
      project: [
        "sid",
        "ticker",
        "name",
        "sector",
        "marketCap",
        "peRatio",
        "pbRatio",
        "divYield",
        "price",
        "change",
        "pchange"
      ]
    };

    const query = { ...defaultQuery, ...body };

    // Try the common Tickertape screener endpoint
    const tickertapeUrl = 'https://api.tickertape.in/screener/query';
    console.log(`Fetching from Tickertape: ${tickertapeUrl}`);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win 64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Origin': 'https://www.tickertape.in',
      'Referer': 'https://www.tickertape.in/screener'
    };

    const response = await fetch(tickertapeUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(query)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Tickertape API error: ${response.status}`, errorText);
      
      // If first attempt fails with 404, try the v2 endpoint as fallback
      if (response.status === 404) {
        const v2Url = 'https://api.tickertape.in/v2/screener/query';
        console.log(`Retrying with fallback: ${v2Url}`);
        const v2Response = await fetch(v2Url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(query)
        });
        
        if (v2Response.ok) {
          const data = await v2Response.json();
          return NextResponse.json(data);
        }
        
        // If both fail, try one more without v2 but with different structure if needed
        // Some versions use /screener/query/pre-defined
      }

      return NextResponse.json({ 
        error: `Tickertape API error: ${response.status}`, 
        details: errorText,
        attemptedUrl: tickertapeUrl 
      }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Screener API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
