import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

console.log('Preview loading...');
const rootElement = document.getElementById('root');
console.log('Root element:', rootElement);

if (rootElement) {
    const root = createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
    console.log('App rendered');
} else {
    console.error('Root element not found');
    document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: Root element not found</div>';
}
