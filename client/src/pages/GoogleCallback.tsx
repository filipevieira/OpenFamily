import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export default function GoogleCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { t } = useTranslation(['integrations', 'common']);
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        const code = searchParams.get('code');
        const error = searchParams.get('error');

        if (error) {
            setStatus('error');
            setErrorMessage(error);
            return;
        }

        if (!code) {
            setStatus('error');
            setErrorMessage('Code de confirmation manquant');
            return;
        }

        const exchangeToken = async () => {
            try {
                const redirectUri = `${window.location.origin}/settings/integrations/google/callback`;
                const res = await fetch(`/api/integrations/google/callback?code=${encodeURIComponent(code)}&redirectUri=${encodeURIComponent(redirectUri)}`, {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
                    },
                });

                const data = await res.json();
                if (data.success) {
                    setStatus('success');
                    setTimeout(() => {
                        navigate('/settings', { replace: true });
                    }, 2000);
                } else {
                    setStatus('error');
                    setErrorMessage(data.error || 'Erreur lors de la connexion Google');
                }
            } catch (err) {
                setStatus('error');
                setErrorMessage(err instanceof Error ? err.message : 'Erreur de connexion');
            }
        };

        exchangeToken();
    }, [searchParams, navigate]);

    return (
        <div className="flex min-h-[60vh] items-center justify-center p-4">
            <Card className="w-full max-w-md text-center shadow-lg">
                <CardContent className="pt-6 space-y-4">
                    {status === 'loading' && (
                        <div className="flex flex-col items-center gap-3 py-6">
                            <Loader2 className="h-10 w-10 animate-spin text-primary" />
                            <h2 className="text-lg font-semibold">{t('google.connecting', 'Connexion à Google Calendar...')}</h2>
                            <p className="text-sm text-muted-foreground">{t('google.pleaseWait', 'Veuillez patienter pendant la finalisation de l’authentification.')}</p>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="flex flex-col items-center gap-3 py-6">
                            <CheckCircle2 className="h-12 w-12 text-green-500 animate-bounce" />
                            <h2 className="text-lg font-semibold text-green-600">{t('google.successTitle', 'Compte Google connecté !')}</h2>
                            <p className="text-sm text-muted-foreground">{t('google.successMessage', 'Redirection vers les paramètres de votre aplicativo...')}</p>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex flex-col items-center gap-3 py-6">
                            <AlertCircle className="h-12 w-12 text-destructive" />
                            <h2 className="text-lg font-semibold text-destructive">{t('google.errorTitle', 'Échec de la connexion')}</h2>
                            <p className="text-sm text-muted-foreground">{errorMessage}</p>
                            <Button className="mt-2" onClick={() => navigate('/settings', { replace: true })}>
                                {t('common:actions.back', 'Retour aux parâmetros')}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
