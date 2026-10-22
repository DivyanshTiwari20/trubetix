async function callApi() {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: "How many Instagram posts did Pranavi Urs get in the last 7 days?",
      dateRange: { preset: "7d" }
    })
  });
  
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

callApi().catch(console.error);