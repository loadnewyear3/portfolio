---
title: "Contact"
date: 2026-06-08T21:06:00+05:30
layout: "single"
outputs:
  - html
draft: false
---

## Contact Me

<form id="portfolio-form" style="display: flex; flex-direction: column; max-width: 400px; gap: 10px;">
    <input type="text" id="form-name" placeholder="Your Name" required style="padding: 8px;">
    <input type="email" id="form-email" placeholder="Your Email" required style="padding: 8px;">
    <textarea id="form-message" placeholder="Your Message" rows="5" required style="padding: 8px;"></textarea>
    <button type="submit" style="padding: 10px; background: #007acc; color: white; border: none; cursor: pointer;">Send Message</button>
</form>

<p id="form-status" style="margin-top: 10px; font-weight: bold; color: green;"></p>

<script>
document.getElementById('portfolio-form').addEventListener('submit', async function(e) {
    e.preventDefault(); // Stop the page from reloading
    
    const statusText = document.getElementById('form-status');
    statusText.innerText = "Sending...";

    // 1. Gather the form inputs
    const payload = {
        name: document.getElementById('form-name').value,
        email: document.getElementById('form-email').value,
        message: document.getElementById('form-message').value
    };

    try {
        // 2. Fire the data directly to your local n8n test webhook
        const response = await fetch('http://localhost:5678/webhook-test/portfolio-contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // 3. Handle the response
        if (response.ok) {
            statusText.innerText = "Message sent successfully! Check your inbox.";
            document.getElementById('portfolio-form').reset();
        } else {
            statusText.innerText = "Backend accepted the request, but returned an error.";
        }
    } catch (error) {
        statusText.innerText = "Could not connect to the backend. Is your n8n container running?";
        console.error(error);
    }
});
</script>
