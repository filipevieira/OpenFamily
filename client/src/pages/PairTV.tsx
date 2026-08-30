import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Tv, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

const PairTV: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [code, setCode] = useState(searchParams.get('code') || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        const paramCode = searchParams.get('code');
        if (paramCode) setCode(paramCode);
    }, [searchParams]);

    const handleAuthorize = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const cleanCode = code.replace(/\D/g, '').trim();
        if (cleanCode.length !== 6) {
            setError('Digite o código de 6 dígitos exibido na TV.');
            return;
        }

        setLoading(true);
        setError('');
        try {
            const res = await api.post<{ success: boolean; error?: string }>('/api/kiosk/pair/authorize', { code: cleanCode });
            if (res.success) {
                setSuccess(true);
            } else {
                setError(res.error || 'Erro ao conectar TV.');
            }
        } catch (err: any) {
            setError(err instanceof Error ? err.message : 'Erro de conexão.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[80vh] flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-lg p-6 space-y-6">
                <div className="flex flex-col items-center text-center gap-2">
                    <div className="p-3 bg-primary/10 rounded-full text-primary">
                        <Tv className="h-8 w-8" />
                    </div>
                    <h1 className="text-xl font-bold tracking-tight">Conectar TV da Família</h1>
                    <p className="text-caption text-muted-foreground">
                        Autorize uma nova Smart TV ou Google TV para exibir o painel do OpenFamily sem precisar digitar senha.
                    </p>
                </div>

                {success ? (
                    <div className="flex flex-col items-center text-center p-6 bg-success/10 border border-success/30 rounded-lg space-y-3">
                        <CheckCircle2 className="h-12 w-12 text-success" />
                        <h2 className="text-lg font-bold text-success">TV Conectada com Sucesso!</h2>
                        <p className="text-caption text-muted-foreground">
                            A sua TV já está carregando o painel Kiosk da família automaticamente.
                        </p>
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            className="mt-2 w-full py-2.5 bg-primary text-white rounded-input text-caption font-medium hover:bg-primary/90 transition-colors"
                        >
                            Voltar ao Dashboard
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleAuthorize} className="space-y-4">
                        {error && (
                            <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/30 text-danger text-caption rounded-lg">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label className="text-caption font-medium text-foreground block">
                                Código de 6 Dígitos da TV
                            </label>
                            <input
                                type="text"
                                maxLength={6}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="ex: 849201"
                                className="w-full text-center text-2xl font-mono tracking-widest py-3 px-4 rounded-input border border-border bg-surface-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || code.replace(/\D/g, '').length !== 6}
                            className="w-full py-3 bg-primary text-white rounded-input font-bold text-caption shadow hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" /> Conectando...
                                </>
                            ) : (
                                <>
                                    <Tv className="h-4 w-4" /> Autorizar esta TV
                                </>
                            )}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default PairTV;
