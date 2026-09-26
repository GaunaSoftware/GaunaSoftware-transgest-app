package com.gaunasoftware.transgest;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DriverTrackingPlugin.class);
        registerPlugin(DriverDocumentsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
