import React, { useState } from 'react';
import './SignIn.css';

interface SignInProps {
  onSignIn: () => void;
}

const SignIn: React.FC<SignInProps> = ({ onSignIn }) => {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode) return;

    // Base64 encode the passcode
    const encoded = btoa(passcode);
    
    // Set cookie that never expires (technically sets it for 10 years)
    const d = new Date();
    d.setTime(d.getTime() + (3650 * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    
    // Set the cookie
    document.cookie = `auth_token=${encoded};${expires};path=/;SameSite=Strict`;

    // Try a simple API call to verify if the token is valid
    try {
        const res = await fetch('/api/tags');
        if (res.status === 401) {
            setError("Incorrect passcode.");
            // Clear the cookie
            document.cookie = "auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        } else {
             onSignIn();
        }
    } catch (err) {
        console.error("Auth check failed", err);
        setError("Network error. Please try again.");
    }
  };

  return (
    <div className="signin-container">
      <form onSubmit={handleSubmit} className="signin-form">
        <h2>Open Flix</h2>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Enter Passcode"
          className="signin-input"
          autoFocus
        />
        {error && <p className="signin-error">{error}</p>}
        <button type="submit" className="signin-button">Sign In</button>
      </form>
    </div>
  );
};

export default SignIn;
