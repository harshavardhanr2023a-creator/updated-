package com.campusconnect.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Hosts the offline Campus Connect web app (assets/index.html) in a WebView and exposes
 * Android speech recognition, text-to-speech and external-link opening to it as "AndroidBridge".
 */
public class MainActivity extends Activity {
    private static final int REQ_AUDIO = 42;
    private static final String START_URL = "file:///android_asset/index.html";

    private WebView web;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingLocale = null;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F4F7FB"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);                 // needed to read file:///android_asset
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("file:///android_asset/")) return false;
                openExternal(url);   // anything else (Maps, vit.ac.in, tel:, mailto:) goes to the right app
                return true;
            }
        });

        tts = new TextToSpeech(this, status -> ttsReady = (status == TextToSpeech.SUCCESS));

        if (savedInstanceState == null) web.loadUrl(START_URL);
        else web.restoreState(savedInstanceState);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /* ---------------- bridge exposed to JavaScript ---------------- */

    private class Bridge {
        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(() -> openExternal(url));
        }

        @JavascriptInterface
        public void startListening(final String localeTag) {
            runOnUiThread(() -> beginListening(localeTag));
        }

        @JavascriptInterface
        public void stopListening() {
            runOnUiThread(() -> { if (recognizer != null) recognizer.stopListening(); });
        }

        @JavascriptInterface
        public void speak(final String text, final String localeTag) {
            runOnUiThread(() -> speakNow(text, localeTag));
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> { if (tts != null) tts.stop(); });
        }
    }

    /* ---------------- external links ---------------- */

    private void openExternal(String url) {
        if (url == null) return;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equals("https") || scheme.equals("http") || scheme.equals("tel") || scheme.equals("mailto"))) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app found to open this link", Toast.LENGTH_SHORT).show();
        }
    }

    /* ---------------- JS callbacks ---------------- */

    private void js(final String script) {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(script, null); });
    }

    private void jsSpeechError(String code) {
        js("window.onNativeSpeechError && window.onNativeSpeechError(" + JSONObject.quote(code) + ")");
    }

    /* ---------------- speech recognition ---------------- */

    private void beginListening(String localeTag) {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            jsSpeechError("unavailable");
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingLocale = localeTag;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
            return;
        }
        if (tts != null) tts.stop();
        destroyRecognizer();
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) { js("window.onNativeSpeechState && window.onNativeSpeechState('listening')"); }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onRmsChanged(float rmsdB) { }
            @Override public void onBufferReceived(byte[] buffer) { }
            @Override public void onEndOfSpeech() { js("window.onNativeSpeechState && window.onNativeSpeechState('processing')"); }
            @Override public void onPartialResults(Bundle partialResults) { }
            @Override public void onEvent(int eventType, Bundle params) { }

            @Override
            public void onResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String text = (list == null || list.isEmpty()) ? "" : list.get(0);
                js("window.onNativeSpeechResult && window.onNativeSpeechResult(" + JSONObject.quote(text) + ")");
            }

            @Override
            public void onError(int error) {
                switch (error) {
                    case SpeechRecognizer.ERROR_NO_MATCH:
                    case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                        jsSpeechError("nomatch"); break;
                    case SpeechRecognizer.ERROR_NETWORK:
                    case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                    case SpeechRecognizer.ERROR_SERVER:
                        jsSpeechError("network"); break;
                    case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                        jsSpeechError("permission"); break;
                    default:
                        jsSpeechError("other");
                }
            }
        });

        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, localeTag);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        recognizer.startListening(i);
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_AUDIO) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        String tag = pendingLocale;
        pendingLocale = null;
        if (granted && tag != null) beginListening(tag);
        else jsSpeechError("permission");
    }

    /* ---------------- text to speech ---------------- */

    private void speakNow(String text, String localeTag) {
        if (tts == null || !ttsReady) {
            js("window.onNativeTtsError && window.onNativeTtsError()");
            return;
        }
        int r = tts.setLanguage(Locale.forLanguageTag(localeTag));
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            js("window.onNativeTtsError && window.onNativeTtsError()");
            return;
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "campusconnect");
    }

    /* ---------------- lifecycle ---------------- */

    @Override
    public void onBackPressed() {
        // let the web app close its menu first; otherwise leave the app
        web.evaluateJavascript("(window.CCBack && window.CCBack()) === true", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (tts != null) tts.stop();
        destroyRecognizer();
    }

    @Override
    protected void onDestroy() {
        destroyRecognizer();
        if (tts != null) { tts.shutdown(); tts = null; }
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
