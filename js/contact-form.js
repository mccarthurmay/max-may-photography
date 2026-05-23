// Google Apps Script Web App URL
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxmJb9T_O1H9pdqAeErEog5nbepOBVHv6-x_IRvmnLOHQMsAZ8zn_C7dg-vOnFymNzm/exec';

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('contact-form');
    const messageDiv = document.getElementById('form-message');
    const submitButton = form.querySelector('.submit-button');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Get form data
        const formData = {
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            message: document.getElementById('message').value,
            reason: document.getElementById('reason').value || 'Not specified'
        };

        // Disable submit button and show loading state
        submitButton.disabled = true;
        submitButton.textContent = 'Sending...';
        messageDiv.textContent = '';
        messageDiv.className = 'form-message';

        try {
            // Send to Google Sheets
            const response = await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            // Note: no-cors mode doesn't allow reading response, so we assume success
            // Show success message
            messageDiv.textContent = 'Thank you! I will get to your submission as soon as possible.';
            messageDiv.className = 'form-message success';

            // Reset form
            form.reset();

        } catch (error) {
            // Show error message
            console.error('Error:', error);
            messageDiv.textContent = 'Sorry, there was an error sending your message. Please try again or email me directly.';
            messageDiv.className = 'form-message error';
        } finally {
            // Re-enable submit button
            submitButton.disabled = false;
            submitButton.textContent = 'Submit';
        }
    });
});
