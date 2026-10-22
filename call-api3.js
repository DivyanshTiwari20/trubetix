async function callApi(message, dateRange) {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      dateRange
    })
  });
  
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

// Test with custom date range for last 4 days
const now = new Date();
const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
callApi("#IGPL posts last 4 days", { 
  preset: "custom", 
  from: fourDaysAgo.toISOString().slice(0, 10), 
  to: now.toISOString().slice(0, 10) 
}).catch(console.error);