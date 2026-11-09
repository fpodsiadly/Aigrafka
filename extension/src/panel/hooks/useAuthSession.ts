import React, { useCallback, useEffect, useState } from 'react';

import { useAppStore } from '../../store/appStore';
import { clearGenerationResults } from './useGeneration';
import {
    authMe,
    deleteMyData,
    googleLogin,
    loadProfile,
    saveProfile,
    startCheckout,
} from '../api';
import { FormState } from '../types';
import { authStorage, selfieStorage, storage } from '../utils';

interface UseAuthSessionArgs {
    form: FormState;
    setForm: React.Dispatch<React.SetStateAction<FormState>>;
}

const LOGGED_OUT = { loggedIn: false, tokens: 0, accessToken: null, email: undefined, userId: undefined };

/** Google login, session refresh, profile sync and token purchase. */
export default function useAuthSession({ form, setForm }: UseAuthSessionArgs) {
    const auth = useAppStore((state) => state.auth);
    const setAuth = useAppStore((state) => state.setAuth);
    const setStatusSuccess = useAppStore((state) => state.setStatusSuccess);
    const setStatusError = useAppStore((state) => state.setStatusError);

    const [showAuthDialog, setShowAuthDialog] = useState<boolean>(false);
    const [authSubmitting, setAuthSubmitting] = useState<boolean>(false);
    const [showPurchaseDialog, setShowPurchaseDialog] = useState<boolean>(false);
    const [purchaseSubmitting, setPurchaseSubmitting] = useState<boolean>(false);
    const [profileReadyForUser, setProfileReadyForUser] = useState<string | null>(null);

    const isProfileHydrating = Boolean(auth.loggedIn && auth.userId && profileReadyForUser !== auth.userId);

    const hydrateProfile = useCallback(async (userId: string, token: string) => {
        try {
            const profile = await loadProfile(userId, token);
            if (!profile) {
                setProfileReadyForUser(userId);
                return;
            }
            setForm((prev) => ({
                ...prev,
                height: profile.height || prev.height,
                chest: profile.chest || prev.chest,
                waist: profile.waist || prev.waist,
                hips: profile.hips || prev.hips,
                fitStyle:
                    profile.fitStyle === 'feminine' || profile.fitStyle === 'unisex' || profile.fitStyle === 'masculine'
                        ? profile.fitStyle
                        : prev.fitStyle,
                accepted: typeof profile.consentGiven === 'boolean' ? profile.consentGiven : prev.accepted,
            }));
        } catch (error) {
            console.error(error);
        } finally {
            setProfileReadyForUser(userId);
        }
    }, [setForm]);

    const refreshAuthFromServer = useCallback(async (tokenOverride?: string | null): Promise<boolean> => {
        const token = tokenOverride ?? auth.accessToken;
        if (!token) {
            setAuth(LOGGED_OUT);
            setProfileReadyForUser(null);
            return false;
        }

        try {
            const data = await authMe(token);
            setAuth({ loggedIn: true, tokens: data.tokens, accessToken: token, email: data.email, userId: data.user_id });
            await hydrateProfile(data.user_id, token);
            return true;
        } catch (error) {
            console.error(error);
            await authStorage.clearToken();
            setAuth(LOGGED_OUT);
            setProfileReadyForUser(null);
            return false;
        }
    }, [auth.accessToken, hydrateProfile, setAuth]);

    const handleLogin = useCallback(() => {
        setShowAuthDialog(true);
    }, []);

    const closeAuthDialog = useCallback(() => {
        if (authSubmitting) return;
        setShowAuthDialog(false);
    }, [authSubmitting]);

    const handleGoogleCredential = useCallback(async (credential: string) => {
        if (!credential) {
            setStatusError('Nie udało się pobrać tokenu Google.');
            return;
        }
        setAuthSubmitting(true);
        try {
            const data = await googleLogin(credential);
            await authStorage.setToken(data.access_token);
            setAuth({ loggedIn: true, tokens: data.tokens, accessToken: data.access_token, email: data.email, userId: data.user_id });
            await hydrateProfile(data.user_id, data.access_token);
            setShowAuthDialog(false);
            setStatusSuccess(`Zalogowano przez Google jako ${data.email}.`);
        } catch (error) {
            console.error(error);
            setStatusError(error instanceof Error ? error.message : 'Błąd logowania Google.');
        } finally {
            setAuthSubmitting(false);
        }
    }, [hydrateProfile, setAuth, setStatusError, setStatusSuccess]);

    const handleGoogleLogin = useCallback(async () => {
        setAuthSubmitting(true);
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'AIGRAFKA_GOOGLE_LOGIN',
            }) as { ok?: boolean; credential?: string; error?: string };
            if (!response?.ok || !response.credential) {
                throw new Error(response?.error || 'Nie udało się zalogować przez Google.');
            }
            await handleGoogleCredential(response.credential);
        } catch (error) {
            console.error(error);
            setStatusError(error instanceof Error ? error.message : 'Błąd logowania Google.');
            setAuthSubmitting(false);
        }
    }, [handleGoogleCredential, setStatusError]);

    const handleLogout = useCallback(async () => {
        await authStorage.clearToken();
        setAuth(LOGGED_OUT);
        setProfileReadyForUser(null);
        setForm((prev) => ({ ...prev, height: '', chest: '', waist: '', hips: '' }));
        setStatusSuccess('Wylogowano.');
    }, [setAuth, setForm, setStatusSuccess]);

    function handleTopUpTokens() {
        if (!auth.loggedIn || !auth.accessToken) {
            setShowAuthDialog(true);
            return;
        }
        setShowPurchaseDialog(true);
    }

    const closePurchaseDialog = useCallback(() => {
        setShowPurchaseDialog(false);
    }, []);

    /** Called after the user accepted the purchase consents in the dialog. */
    async function handleConfirmPurchase() {
        if (!auth.accessToken) return;
        setPurchaseSubmitting(true);
        try {
            const response = await startCheckout(auth.accessToken);
            if (!response?.ok) {
                throw new Error(response?.error || 'Nie udało się rozpocząć płatności.');
            }
            setShowPurchaseDialog(false);
            setStatusSuccess('Otworzono płatność Przelewy24. Tokeny pojawią się po jej zakończeniu.');
        } catch (error) {
            console.error(error);
            setStatusError(error instanceof Error ? error.message : 'Nie udało się rozpocząć płatności.');
        } finally {
            setPurchaseSubmitting(false);
        }
    }

    /**
     * Erase personal data: the cached selfie and measurements in this browser and,
     * when logged in, the server-side profile and every stored image of the user.
     */
    async function handleDeleteMyData() {
        try {
            if (auth.loggedIn && auth.accessToken) {
                await deleteMyData(auth.accessToken);
            }
            await selfieStorage.clear();
            await storage.clear();
            clearGenerationResults();
            setForm((prev) => ({ ...prev, selfie: null, height: '', chest: '', waist: '', hips: '' }));
            setStatusSuccess('Usunięto Twoje dane: selfie, wymiary i zapisane stylizacje.');
        } catch (error) {
            console.error(error);
            setStatusError(error instanceof Error ? error.message : 'Nie udało się usunąć danych.');
        }
    }

    useEffect(() => {
        authStorage.getToken().then((token) => {
            if (!token) return;
            refreshAuthFromServer(token);
        });
    }, [refreshAuthFromServer]);

    useEffect(() => {
        if (!auth.loggedIn || !auth.accessToken || !auth.userId) return;
        if (profileReadyForUser !== auth.userId) return;

        const timeoutId = window.setTimeout(() => {
            saveProfile(auth.accessToken as string, {
                userId: auth.userId as string,
                height: form.height,
                chest: form.chest,
                waist: form.waist,
                hips: form.hips,
                fitStyle: form.fitStyle,
                consentGiven: form.accepted,
            }).catch((error) => console.error(error));
        }, 450);

        return () => window.clearTimeout(timeoutId);
    }, [
        auth.loggedIn,
        auth.accessToken,
        auth.userId,
        profileReadyForUser,
        form.height,
        form.chest,
        form.waist,
        form.hips,
        form.fitStyle,
        form.accepted,
    ]);

    useEffect(() => {
        if (!showAuthDialog) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeAuthDialog();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [showAuthDialog, closeAuthDialog]);

    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === 'visible' && auth.loggedIn) {
                void refreshAuthFromServer();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [auth.loggedIn, refreshAuthFromServer]);

    return {
        auth,
        isProfileHydrating,
        showAuthDialog,
        authSubmitting,
        showPurchaseDialog,
        purchaseSubmitting,
        refreshAuthFromServer,
        handleLogin,
        closeAuthDialog,
        handleGoogleLogin,
        handleLogout,
        handleTopUpTokens,
        closePurchaseDialog,
        handleConfirmPurchase,
        handleDeleteMyData,
    };
}
