import React, { Component, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[AIgrafka] panel error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div
                    style={{
                        padding: '16px',
                        background: '#f8d7da',
                        color: '#721c24',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontFamily: 'system-ui, sans-serif',
                    }}
                >
                    <strong>Błąd panelu AIgrafka</strong>
                    <p>Odśwież stronę lub kliknij ikonę rozszerzenia ponownie.</p>
                    {this.state.error && (
                        <pre style={{ fontSize: '11px', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
                    )}
                </div>
            );
        }
        return this.props.children;
    }
}
