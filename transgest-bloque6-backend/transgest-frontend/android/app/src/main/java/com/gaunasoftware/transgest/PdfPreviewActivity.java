package com.gaunasoftware.transgest;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;

/** Private in-app viewer. Back/Close returns to the still-mounted signing form. */
public class PdfPreviewActivity extends Activity {
 private ParcelFileDescriptor descriptor;
 private PdfRenderer renderer;
 private Bitmap bitmap;
 private ImageView image;
 private TextView pageLabel;
 private Button previous;
 private Button next;
 private int currentPage;

 @Override public void onCreate(Bundle state){super.onCreate(state);
  LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.WHITE);
  Button close=new Button(this);close.setText("Cerrar y volver a la firma");close.setOnClickListener(v->finish());layout.addView(close);
  LinearLayout controls=new LinearLayout(this);controls.setOrientation(LinearLayout.HORIZONTAL);
  previous=new Button(this);previous.setText("Anterior");previous.setOnClickListener(v->showPage(currentPage-1));controls.addView(previous,new LinearLayout.LayoutParams(0,-2,1));
  pageLabel=new TextView(this);pageLabel.setTextColor(Color.BLACK);pageLabel.setTextSize(14);pageLabel.setGravity(17);controls.addView(pageLabel,new LinearLayout.LayoutParams(0,-2,1));
  next=new Button(this);next.setText("Siguiente");next.setOnClickListener(v->showPage(currentPage+1));controls.addView(next,new LinearLayout.LayoutParams(0,-2,1));layout.addView(controls);
  ScrollView scroll=new ScrollView(this);image=new ImageView(this);image.setAdjustViewBounds(true);image.setScaleType(ImageView.ScaleType.FIT_CENTER);scroll.addView(image,new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.WRAP_CONTENT));layout.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);
  try{
   File root=new File(getFilesDir(),"driver_documents").getCanonicalFile();
   String path=getIntent().getStringExtra("pdf_path");if(path==null)throw new Exception("Documento no disponible");
   File file=new File(path).getCanonicalFile();
   if(!file.getPath().startsWith(root.getPath()+File.separator)||!file.isFile())throw new Exception("Documento no disponible");
   descriptor=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);renderer=new PdfRenderer(descriptor);
   if(renderer.getPageCount()<1)throw new Exception("PDF sin páginas");showPage(0);
  }catch(Exception e){pageLabel.setText("No se pudo mostrar el justificante. Cierra y vuelve a intentarlo.");previous.setEnabled(false);next.setEnabled(false);}
 }

 private void showPage(int index){
  if(renderer==null||index<0||index>=renderer.getPageCount())return;
  try(PdfRenderer.Page page=renderer.openPage(index)){
   int width=Math.min(2048,Math.max(320,getResources().getDisplayMetrics().widthPixels));
   int height=Math.min(4096,Math.max(1,Math.round(width*((float)page.getHeight()/page.getWidth()))));
   Bitmap rendered=Bitmap.createBitmap(width,height,Bitmap.Config.RGB_565);rendered.eraseColor(Color.WHITE);
   page.render(rendered,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
   image.setImageBitmap(rendered);if(bitmap!=null)bitmap.recycle();bitmap=rendered;currentPage=index;
   pageLabel.setText((index+1)+" / "+renderer.getPageCount());previous.setEnabled(index>0);next.setEnabled(index+1<renderer.getPageCount());
  }catch(Exception e){pageLabel.setText("No se pudo abrir esta página.");}
 }

 @Override public void onDestroy(){image.setImageDrawable(null);if(bitmap!=null)bitmap.recycle();try{if(renderer!=null)renderer.close();}catch(Exception ignored){}try{if(descriptor!=null)descriptor.close();}catch(Exception ignored){}super.onDestroy();}
}
