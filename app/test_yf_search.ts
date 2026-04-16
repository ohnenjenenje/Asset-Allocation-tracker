import YahooFinance from 'yahoo-finance2';

async function test() {
  const yahoo = new YahooFinance();
  const name = 'HDFC Flexi Cap Fund - Growth Option - Direct Plan';
  const cleanName = name.replace(/Direct Plan|Retail Plan|Regular Plan|Direct|Regular|Growth|IDCW|Dividend|Option|Plan|Scheme|Index Fund|Fund|Index/gi, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  console.log('Clean name:', cleanName);
  const ySearch = await yahoo.search(cleanName, { quotesCount: 5 });
  const match = ySearch.quotes.find((q: any) => (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund'));
  console.log(match);
}
test();
