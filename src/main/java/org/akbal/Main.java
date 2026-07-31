package org.akbal;

import com.formdev.flatlaf.FlatDarkLaf;
import org.akbal.i18n.LocaleManager;
import org.akbal.ui.MainFrame;
import org.akbal.ui.UIConstants;

import javax.swing.*;
import java.awt.*;

public class Main {
    public static void main(String[] args) {
        // ── Initialize i18n (loads saved locale from disk) ───────────────────
        LocaleManager.getInstance();

        // ── FlatLaf Dark Setup ───────────────────────────────────────────────
        FlatDarkLaf.setup();

        // ── Global UIManager overrides ───────────────────────────────────────
        UIManager.put("Panel.background", UIConstants.BG_PRIMARY);
        UIManager.put("control", UIConstants.BG_PRIMARY);

        // Buttons
        UIManager.put("Button.arc", UIConstants.RADIUS * 2);
        UIManager.put("Button.background", UIConstants.BG_SURFACE);
        UIManager.put("Button.foreground", UIConstants.TEXT_PRIMARY);
        UIManager.put("Button.hoverBackground", UIConstants.BG_CARD);
        UIManager.put("Button.pressedBackground", UIConstants.ACCENT_DIM);

        // Text fields
        UIManager.put("TextField.background", UIConstants.BG_INPUT);
        UIManager.put("TextField.foreground", UIConstants.TEXT_PRIMARY);
        UIManager.put("TextField.caretForeground", UIConstants.ACCENT);
        UIManager.put("TextField.selectionBackground", UIConstants.ACCENT_DIM);
        UIManager.put("TextField.selectionForeground", Color.WHITE);
        UIManager.put("TextField.arc", UIConstants.RADIUS * 2);

        UIManager.put("PasswordField.background", UIConstants.BG_INPUT);
        UIManager.put("PasswordField.foreground", UIConstants.TEXT_PRIMARY);
        UIManager.put("PasswordField.caretForeground", UIConstants.ACCENT);
        UIManager.put("PasswordField.arc", UIConstants.RADIUS * 2);

        // ComboBox
        UIManager.put("ComboBox.background", UIConstants.BG_INPUT);
        UIManager.put("ComboBox.foreground", UIConstants.TEXT_PRIMARY);
        UIManager.put("ComboBox.selectionBackground", UIConstants.ACCENT);
        UIManager.put("ComboBox.selectionForeground", UIConstants.BG_PRIMARY);
        UIManager.put("ComboBox.arc", UIConstants.RADIUS * 2);

        // Spinner
        UIManager.put("Spinner.background", UIConstants.BG_INPUT);
        UIManager.put("Spinner.foreground", UIConstants.TEXT_PRIMARY);
        UIManager.put("Spinner.arc", UIConstants.RADIUS * 2);

        // Table
        UIManager.put("Table.background", UIConstants.TABLE_ROW_EVEN);
        UIManager.put("Table.foreground", UIConstants.TEXT_PRIMARY);
        UIManager.put("Table.selectionBackground", UIConstants.TABLE_SELECTION_BG);
        UIManager.put("Table.selectionForeground", UIConstants.TABLE_SELECTION_FG);
        UIManager.put("Table.gridColor", UIConstants.BORDER_SUBTLE);
        UIManager.put("Table.showHorizontalLines", true);
        UIManager.put("Table.showVerticalLines", false);
        UIManager.put("Table.intercellSpacing", new Dimension(0, 1));

        UIManager.put("TableHeader.background", UIConstants.TABLE_HEADER_BG);
        UIManager.put("TableHeader.foreground", UIConstants.TEXT_SECONDARY);
        UIManager.put("TableHeader.separatorColor", UIConstants.BORDER_SUBTLE);
        UIManager.put("TableHeader.bottomSeparatorColor", UIConstants.ACCENT_DIM);

        // ScrollBars
        UIManager.put("ScrollBar.track", UIConstants.BG_SECONDARY);
        UIManager.put("ScrollBar.thumb", UIConstants.BORDER_DEFAULT);
        UIManager.put("ScrollBar.hoverThumbColor", UIConstants.ACCENT_DIM);
        UIManager.put("ScrollBar.width", 10);
        UIManager.put("ScrollBar.thumbArc", 999);
        UIManager.put("ScrollBar.trackArc", 999);
        UIManager.put("ScrollBar.thumbInsets", new Insets(2, 2, 2, 2));

        // Separator
        UIManager.put("Separator.foreground", UIConstants.BORDER_SUBTLE);

        // OptionPane
        UIManager.put("OptionPane.background", UIConstants.BG_SECONDARY);
        UIManager.put("OptionPane.messageForeground", UIConstants.TEXT_PRIMARY);
        UIManager.put("OptionPane.buttonFont", UIConstants.FONT_BODY_BOLD);

        // SplitPane
        UIManager.put("SplitPane.background", UIConstants.BG_PRIMARY);
        UIManager.put("SplitPaneDivider.draggingColor", UIConstants.ACCENT_DIM);
        UIManager.put("SplitPane.dividerSize", 6);

        // TitledBorder (fallback)
        UIManager.put("TitledBorder.titleColor", UIConstants.TEXT_SECONDARY);
        UIManager.put("TitledBorder.border", BorderFactory.createLineBorder(UIConstants.BORDER_SUBTLE));

        // TextArea
        UIManager.put("TextArea.background", UIConstants.BG_INPUT);
        UIManager.put("TextArea.foreground", UIConstants.TEXT_PRIMARY);
        UIManager.put("TextArea.caretForeground", UIConstants.ACCENT);
        UIManager.put("TextArea.selectionBackground", UIConstants.ACCENT_DIM);
        UIManager.put("TextArea.selectionForeground", Color.WHITE);

        // Label
        UIManager.put("Label.foreground", UIConstants.TEXT_PRIMARY);

        // ToolTip
        UIManager.put("ToolTip.background", UIConstants.BG_CARD);
        UIManager.put("ToolTip.foreground", UIConstants.TEXT_PRIMARY);

        // ── Antialiasing ─────────────────────────────────────────────────────
        System.setProperty("awt.useSystemAAFontSettings", "on");
        System.setProperty("swing.aatext", "true");

        // ── Launch ───────────────────────────────────────────────────────────
        SwingUtilities.invokeLater(() -> {
            MainFrame frame = new MainFrame();
            frame.setVisible(true);
        });
    }
}