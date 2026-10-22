async function callApi(message) {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      dateRange: { preset: "7d" }
    })
  });
  
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

callApi("tll m numbr of post don on PranaviUrs in last 7 days on insta only").catch(console.error);