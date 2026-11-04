#include "my_application.h"

#include <flutter_linux/flutter_linux.h>
#ifdef GDK_WINDOWING_X11
#include <gdk/gdkx.h>
#endif

#include "flutter/generated_plugin_registrant.h"

struct _MyApplication {
  GtkApplication parent_instance;
  char** dart_entrypoint_arguments;
};

G_DEFINE_TYPE(MyApplication, my_application, GTK_TYPE_APPLICATION)

// Size, position and maximized state of the window between starts
// (docs/features/desktop.md §4): <XDG config dir>/stachel/window.ini.
// Wayland ignores the position (the compositor places windows).
typedef struct {
  gint x, y, width, height;
  gboolean has_position;
  gboolean maximized;
} WindowState;

static WindowState window_state = {0, 0, 1280, 800, FALSE, FALSE};

static gchar* window_state_path() {
  return g_build_filename(g_get_user_config_dir(), "stachel", "window.ini",
                          nullptr);
}

static void load_window_state() {
  g_autofree gchar* path = window_state_path();
  g_autoptr(GKeyFile) file = g_key_file_new();
  if (!g_key_file_load_from_file(file, path, G_KEY_FILE_NONE, nullptr)) {
    return;
  }
  g_autoptr(GError) error = nullptr;
  gint width = g_key_file_get_integer(file, "window", "width", &error);
  gint height = error ? 0 : g_key_file_get_integer(file, "window", "height", &error);
  if (error || width < 480 || height < 560) {
    return;
  }
  window_state.width = width;
  window_state.height = height;
  g_autoptr(GError) pos_error = nullptr;
  gint x = g_key_file_get_integer(file, "window", "x", &pos_error);
  gint y = pos_error ? 0 : g_key_file_get_integer(file, "window", "y", &pos_error);
  if (!pos_error) {
    window_state.x = x;
    window_state.y = y;
    window_state.has_position = TRUE;
  }
  window_state.maximized =
      g_key_file_get_boolean(file, "window", "maximized", nullptr);
}

static void save_window_state() {
  g_autofree gchar* path = window_state_path();
  g_autofree gchar* dir = g_path_get_dirname(path);
  g_mkdir_with_parents(dir, 0700);
  g_autoptr(GKeyFile) file = g_key_file_new();
  g_key_file_set_integer(file, "window", "width", window_state.width);
  g_key_file_set_integer(file, "window", "height", window_state.height);
  if (window_state.has_position) {
    g_key_file_set_integer(file, "window", "x", window_state.x);
    g_key_file_set_integer(file, "window", "y", window_state.y);
  }
  g_key_file_set_boolean(file, "window", "maximized", window_state.maximized);
  g_key_file_save_to_file(file, path, nullptr);
}

// Remembers the normal (not maximized) size and position while it changes.
static gboolean window_configure_cb(GtkWidget* widget, GdkEvent* event,
                                    gpointer data) {
  GtkWindow* window = GTK_WINDOW(widget);
  if (!gtk_window_is_maximized(window)) {
    gtk_window_get_size(window, &window_state.width, &window_state.height);
    gtk_window_get_position(window, &window_state.x, &window_state.y);
    window_state.has_position = TRUE;
  }
  return FALSE;
}

// The window closes: keep its state for the next start.
static gboolean window_delete_cb(GtkWidget* widget, GdkEvent* event,
                                 gpointer data) {
  window_state.maximized = gtk_window_is_maximized(GTK_WINDOW(widget));
  save_window_state();
  return FALSE;
}

// Called when first Flutter frame received.
static void first_frame_cb(MyApplication* self, FlView* view) {
  gtk_widget_show(gtk_widget_get_toplevel(GTK_WIDGET(view)));
}

// Implements GApplication::activate.
static void my_application_activate(GApplication* application) {
  MyApplication* self = MY_APPLICATION(application);

  // Stachel runs once (unique GApplication): a second start only brings the
  // window to the front; its link (stachel://… or https://…) reaches the
  // running app through the command line (app_links, docs/release/desktop.md).
  GList* windows = gtk_application_get_windows(GTK_APPLICATION(application));
  if (windows) {
    gtk_window_present(GTK_WINDOW(windows->data));
    return;
  }

  GtkWindow* window =
      GTK_WINDOW(gtk_application_window_new(GTK_APPLICATION(application)));

  // Use a header bar when running in GNOME as this is the common style used
  // by applications and is the setup most users will be using (e.g. Ubuntu
  // desktop).
  // If running on X and not using GNOME then just use a traditional title bar
  // in case the window manager does more exotic layout, e.g. tiling.
  // If running on Wayland assume the header bar will work (may need changing
  // if future cases occur).
  gboolean use_header_bar = TRUE;
#ifdef GDK_WINDOWING_X11
  GdkScreen* screen = gtk_window_get_screen(window);
  if (GDK_IS_X11_SCREEN(screen)) {
    const gchar* wm_name = gdk_x11_screen_get_window_manager_name(screen);
    if (g_strcmp0(wm_name, "GNOME Shell") != 0) {
      use_header_bar = FALSE;
    }
  }
#endif
  if (use_header_bar) {
    GtkHeaderBar* header_bar = GTK_HEADER_BAR(gtk_header_bar_new());
    gtk_widget_show(GTK_WIDGET(header_bar));
    gtk_header_bar_set_title(header_bar, "Stachel");
    gtk_header_bar_set_show_close_button(header_bar, TRUE);
    gtk_window_set_titlebar(window, GTK_WIDGET(header_bar));
  } else {
    gtk_window_set_title(window, "Stachel");
  }

  // where it was last time (window.ini), else 1280 x 800
  load_window_state();
  gtk_window_set_default_size(window, window_state.width, window_state.height);
  if (window_state.has_position) {
    gtk_window_move(window, window_state.x, window_state.y);
  }
  if (window_state.maximized) {
    gtk_window_maximize(window);
  }
  g_signal_connect(window, "configure-event", G_CALLBACK(window_configure_cb),
                   nullptr);
  g_signal_connect(window, "delete-event", G_CALLBACK(window_delete_cb),
                   nullptr);
  // Smallest window: about a phone in landscape (room for the board's bars).
  GdkGeometry hints;
  hints.min_width = 480;
  hints.min_height = 560;
  gtk_window_set_geometry_hints(window, nullptr, &hints, GDK_HINT_MIN_SIZE);
  gtk_window_set_icon_name(window, APPLICATION_ID);

  g_autoptr(FlDartProject) project = fl_dart_project_new();
  fl_dart_project_set_dart_entrypoint_arguments(
      project, self->dart_entrypoint_arguments);

  FlView* view = fl_view_new(project);
  GdkRGBA background_color;
  // Background defaults to black, override it here if necessary, e.g. #00000000
  // for transparent.
  gdk_rgba_parse(&background_color, "#000000");
  fl_view_set_background_color(view, &background_color);
  gtk_widget_show(GTK_WIDGET(view));
  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));

  // Show the window when Flutter renders.
  // Requires the view to be realized so we can start rendering.
  g_signal_connect_swapped(view, "first-frame", G_CALLBACK(first_frame_cb),
                           self);
  gtk_widget_realize(GTK_WIDGET(view));

  fl_register_plugins(FL_PLUGIN_REGISTRY(view));

  gtk_widget_grab_focus(GTK_WIDGET(view));
}

// Implements GApplication::local_command_line.
static gboolean my_application_local_command_line(GApplication* application,
                                                  gchar*** arguments,
                                                  int* exit_status) {
  MyApplication* self = MY_APPLICATION(application);
  // Strip out the first argument as it is the binary name.
  self->dart_entrypoint_arguments = g_strdupv(*arguments + 1);

  g_autoptr(GError) error = nullptr;
  if (!g_application_register(application, nullptr, &error)) {
    g_warning("Failed to register: %s", error->message);
    *exit_status = 1;
    return TRUE;
  }

  g_application_activate(application);
  *exit_status = 0;

  // Not handled here: GApplication then sends the command line to the
  // primary instance (this one or the one already running), where app_links
  // reads a link from it.
  return FALSE;
}

// Implements GApplication::startup.
static void my_application_startup(GApplication* application) {
  // MyApplication* self = MY_APPLICATION(object);

  // Perform any actions required at application startup.

  G_APPLICATION_CLASS(my_application_parent_class)->startup(application);
}

// Implements GApplication::shutdown.
static void my_application_shutdown(GApplication* application) {
  // MyApplication* self = MY_APPLICATION(object);

  // Perform any actions required at application shutdown.

  G_APPLICATION_CLASS(my_application_parent_class)->shutdown(application);
}

// Implements GObject::dispose.
static void my_application_dispose(GObject* object) {
  MyApplication* self = MY_APPLICATION(object);
  g_clear_pointer(&self->dart_entrypoint_arguments, g_strfreev);
  G_OBJECT_CLASS(my_application_parent_class)->dispose(object);
}

static void my_application_class_init(MyApplicationClass* klass) {
  G_APPLICATION_CLASS(klass)->activate = my_application_activate;
  G_APPLICATION_CLASS(klass)->local_command_line =
      my_application_local_command_line;
  G_APPLICATION_CLASS(klass)->startup = my_application_startup;
  G_APPLICATION_CLASS(klass)->shutdown = my_application_shutdown;
  G_OBJECT_CLASS(klass)->dispose = my_application_dispose;
}

static void my_application_init(MyApplication* self) {}

MyApplication* my_application_new() {
  // Set the program name to the application ID, which helps various systems
  // like GTK and desktop environments map this running application to its
  // corresponding .desktop file. This ensures better integration by allowing
  // the application to be recognized beyond its binary name.
  g_set_prgname(APPLICATION_ID);

  return MY_APPLICATION(g_object_new(my_application_get_type(),
                                     "application-id", APPLICATION_ID, "flags",
                                     G_APPLICATION_HANDLES_COMMAND_LINE |
                                         G_APPLICATION_HANDLES_OPEN,
                                     nullptr));
}
