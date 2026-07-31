package org.akbal.ui;

import javax.swing.*;
import javax.swing.border.AbstractBorder;
import javax.swing.border.Border;
import javax.swing.border.CompoundBorder;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.awt.event.FocusAdapter;
import java.awt.event.FocusEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.geom.RoundRectangle2D;

/**
 * Central design-system constants and factory methods for the modern dark UI.
 */
public final class UIConstants {

    private UIConstants() {
    }

    // ── Palette ──────────────────────────────────────────────────────────────
    public static final Color BG_PRIMARY = new Color(0x1A1A2E);
    public static final Color BG_SECONDARY = new Color(0x16213E);
    public static final Color BG_SURFACE = new Color(0x1F2940);
    public static final Color BG_CARD = new Color(0x253352);
    public static final Color BG_INPUT = new Color(0x1C2A3F);
    public static final Color BG_HEADER = new Color(0x0F1626);

    public static final Color ACCENT = new Color(0x00BFA5);
    public static final Color ACCENT_HOVER = new Color(0x00E5C7);
    public static final Color ACCENT_DIM = new Color(0x007A6A);

    public static final Color TEXT_PRIMARY = new Color(0xE0E0E0);
    public static final Color TEXT_SECONDARY = new Color(0x90A4AE);
    public static final Color TEXT_MUTED = new Color(0x607D8B);

    public static final Color BORDER_DEFAULT = new Color(0x2A3F5F);
    public static final Color BORDER_FOCUS = ACCENT;
    public static final Color BORDER_SUBTLE = new Color(0x1E3050);

    public static final Color SUCCESS = new Color(0x4CAF50);
    public static final Color WARNING = new Color(0xFFA726);
    public static final Color ERROR = new Color(0xEF5350);

    public static final Color TABLE_ROW_EVEN = new Color(0x1A2740);
    public static final Color TABLE_ROW_ODD = new Color(0x1F2F4A);
    public static final Color TABLE_HEADER_BG = new Color(0x12203A);
    public static final Color TABLE_SELECTION = new Color(0x00BFA5, true); // semi-transparent used via custom alpha below
    public static final Color TABLE_SELECTION_BG = new Color(0x00, 0xBF, 0xA5, 40);
    public static final Color TABLE_SELECTION_FG = new Color(0xFFFFFF);

    // ── Fonts ────────────────────────────────────────────────────────────────
    private static final String[] PREFERRED_SANS = {"Inter", "SF Pro Text", ".SF NS Text", "Helvetica Neue", "Segoe UI", "Roboto"};
    private static final String[] PREFERRED_MONO = {"JetBrains Mono", "Menlo", "Cascadia Code", "Fira Code", "Consolas", "Monospaced"};

    public static final Font FONT_BODY = resolveFont(PREFERRED_SANS, Font.PLAIN, 13);
    public static final Font FONT_BODY_BOLD = resolveFont(PREFERRED_SANS, Font.BOLD, 13);
    public static final Font FONT_SMALL = resolveFont(PREFERRED_SANS, Font.PLAIN, 11);
    public static final Font FONT_HEADING = resolveFont(PREFERRED_SANS, Font.BOLD, 15);
    public static final Font FONT_TITLE = resolveFont(PREFERRED_SANS, Font.BOLD, 18);
    public static final Font FONT_MONO = resolveFont(PREFERRED_MONO, Font.PLAIN, 13);

    // ── Dimensions ───────────────────────────────────────────────────────────
    public static final int RADIUS = 8;
    public static final int INPUT_HEIGHT = 32;
    public static final int BUTTON_HEIGHT = 34;
    public static final int TABLE_ROW_HEIGHT = 34;
    public static final Insets PANEL_INSETS = new Insets(12, 16, 12, 16);

    // ── Font resolver ────────────────────────────────────────────────────────
    private static Font resolveFont(String[] families, int style, int size) {
        GraphicsEnvironment ge = GraphicsEnvironment.getLocalGraphicsEnvironment();
        String[] available = ge.getAvailableFontFamilyNames();
        java.util.Set<String> set = new java.util.HashSet<>(java.util.Arrays.asList(available));
        for (String family : families) {
            if (set.contains(family)) {
                return new Font(family, style, size);
            }
        }
        return new Font(Font.SANS_SERIF, style, size);
    }

    // ── Borders ──────────────────────────────────────────────────────────────

    /** A rounded-rectangle border with configurable color. */
    public static Border createRoundedBorder(Color color, int radius, Insets padding) {
        return new CompoundBorder(new RoundedBorder(color, radius), new EmptyBorder(padding));
    }

    public static Border createRoundedBorder() {
        return createRoundedBorder(BORDER_DEFAULT, RADIUS, new Insets(4, 10, 4, 10));
    }

    // ── Section header ───────────────────────────────────────────────────────

    /** Creates a styled section header with icon + title + thin separator. */
    public static JPanel createSectionHeader(String icon, String title) {
        JPanel panel = new JPanel(new BorderLayout(6, 0));
        panel.setOpaque(false);
        panel.setBorder(new EmptyBorder(8, 0, 8, 0));

        JLabel lbl = new JLabel(icon + "  " + title);
        lbl.setFont(FONT_HEADING);
        lbl.setForeground(TEXT_PRIMARY);
        panel.add(lbl, BorderLayout.WEST);

        JSeparator sep = new JSeparator(SwingConstants.HORIZONTAL);
        sep.setForeground(BORDER_SUBTLE);
        JPanel sepWrap = new JPanel(new BorderLayout());
        sepWrap.setOpaque(false);
        sepWrap.setBorder(new EmptyBorder(10, 8, 0, 0));
        sepWrap.add(sep, BorderLayout.CENTER);
        panel.add(sepWrap, BorderLayout.CENTER);

        return panel;
    }

    // ── Card panel ───────────────────────────────────────────────────────────

    /** Rounded, elevated card panel. */
    public static JPanel createCardPanel() {
        JPanel card = new JPanel() {
            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g2.setColor(BG_CARD);
                g2.fill(new RoundRectangle2D.Float(0, 0, getWidth(), getHeight(), RADIUS * 2, RADIUS * 2));
                g2.dispose();
            }
        };
        card.setOpaque(false);
        card.setBorder(new EmptyBorder(12, 14, 12, 14));
        return card;
    }

    // ── Styled text field ────────────────────────────────────────────────────

    /** Applies modern styling to a JTextField / JPasswordField. */
    public static void styleTextField(JTextField field) {
        field.setFont(FONT_BODY);
        field.setForeground(TEXT_PRIMARY);
        field.setBackground(BG_INPUT);
        field.setCaretColor(ACCENT);
        field.setSelectionColor(ACCENT_DIM);
        field.setSelectedTextColor(Color.WHITE);
        field.setBorder(createRoundedBorder());
        field.setPreferredSize(new Dimension(field.getPreferredSize().width, INPUT_HEIGHT));

        // Focus glow
        field.addFocusListener(new FocusAdapter() {
            @Override
            public void focusGained(FocusEvent e) {
                field.setBorder(createRoundedBorder(BORDER_FOCUS, RADIUS, new Insets(4, 10, 4, 10)));
                field.repaint();
            }

            @Override
            public void focusLost(FocusEvent e) {
                field.setBorder(createRoundedBorder());
                field.repaint();
            }
        });
    }

    /** Applies modern styling to a JSpinner. */
    public static void styleSpinner(JSpinner spinner) {
        spinner.setFont(FONT_BODY);
        spinner.setPreferredSize(new Dimension(spinner.getPreferredSize().width, INPUT_HEIGHT));
        spinner.setBorder(createRoundedBorder());
        JComponent editor = spinner.getEditor();
        if (editor instanceof JSpinner.DefaultEditor de) {
            JTextField tf = de.getTextField();
            tf.setForeground(TEXT_PRIMARY);
            tf.setBackground(BG_INPUT);
            tf.setCaretColor(ACCENT);
            tf.setBorder(new EmptyBorder(0, 4, 0, 4));
        }
    }

    // ── Styled buttons ──────────────────────────────────────────────────────

    public enum ButtonStyle {
        FILLED, OUTLINE, SUBTLE
    }

    /** Creates a modern styled button. */
    public static JButton createStyledButton(String text, ButtonStyle style) {
        JButton btn = new JButton(text) {
            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

                Color bg;
                Color fg;
                if (!isEnabled()) {
                    bg = style == ButtonStyle.FILLED ? ACCENT_DIM : BG_SURFACE;
                    fg = TEXT_MUTED;
                } else if (getModel().isRollover()) {
                    bg = style == ButtonStyle.FILLED ? ACCENT_HOVER : new Color(0x00BFA5, true).brighter();
                    fg = style == ButtonStyle.FILLED ? BG_PRIMARY : ACCENT_HOVER;
                } else {
                    bg = style == ButtonStyle.FILLED ? ACCENT : BG_SURFACE;
                    fg = style == ButtonStyle.FILLED ? BG_PRIMARY : ACCENT;
                }

                RoundRectangle2D shape = new RoundRectangle2D.Float(0, 0, getWidth(), getHeight(), RADIUS * 2, RADIUS * 2);

                if (style == ButtonStyle.FILLED) {
                    g2.setColor(bg);
                    g2.fill(shape);
                } else if (style == ButtonStyle.OUTLINE) {
                    g2.setColor(BG_SURFACE);
                    g2.fill(shape);
                    g2.setColor(isEnabled() ? (getModel().isRollover() ? ACCENT_HOVER : ACCENT) : BORDER_DEFAULT);
                    g2.setStroke(new BasicStroke(1.5f));
                    g2.draw(shape);
                } else {
                    if (getModel().isRollover()) {
                        g2.setColor(new Color(0x00BFA5, true).darker().darker());
                        g2.fill(shape);
                    }
                }

                g2.setColor(fg);
                g2.setFont(getFont());
                FontMetrics fm = g2.getFontMetrics();
                int tx = (getWidth() - fm.stringWidth(getText())) / 2;
                int ty = (getHeight() + fm.getAscent() - fm.getDescent()) / 2;
                g2.drawString(getText(), tx, ty);
                g2.dispose();
            }
        };

        btn.setFont(FONT_BODY_BOLD);
        btn.setForeground(style == ButtonStyle.FILLED ? BG_PRIMARY : ACCENT);
        btn.setContentAreaFilled(false);
        btn.setFocusPainted(false);
        btn.setBorderPainted(false);
        btn.setOpaque(false);
        btn.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        btn.setPreferredSize(new Dimension(btn.getPreferredSize().width + 24, BUTTON_HEIGHT));

        btn.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseEntered(MouseEvent e) {
                btn.repaint();
            }

            @Override
            public void mouseExited(MouseEvent e) {
                btn.repaint();
            }
        });

        return btn;
    }

    // ── Styled combo box ─────────────────────────────────────────────────────

    public static <T> void styleComboBox(JComboBox<T> combo) {
        combo.setFont(FONT_BODY);
        combo.setForeground(TEXT_PRIMARY);
        combo.setBackground(BG_INPUT);
        combo.setBorder(createRoundedBorder());
        combo.setPreferredSize(new Dimension(combo.getPreferredSize().width, INPUT_HEIGHT));
    }

    // ── Rounded Border implementation ────────────────────────────────────────

    private static class RoundedBorder extends AbstractBorder {
        private final Color color;
        private final int radius;

        RoundedBorder(Color color, int radius) {
            this.color = color;
            this.radius = radius;
        }

        @Override
        public void paintBorder(Component c, Graphics g, int x, int y, int width, int height) {
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setColor(color);
            g2.setStroke(new BasicStroke(1.2f));
            g2.drawRoundRect(x, y, width - 1, height - 1, radius * 2, radius * 2);
            g2.dispose();
        }

        @Override
        public Insets getBorderInsets(Component c) {
            return new Insets(0, 0, 0, 0);
        }

        @Override
        public boolean isBorderOpaque() {
            return false;
        }
    }
}
